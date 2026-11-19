// supabase/functions/rudo-chat/booking_test.ts
//
// Unit tests for booking.ts. No network and no real Supabase: the Supabase
// client is a hand-written fake and global fetch is stubbed per test.
// All names, ids and messages below are synthetic.
//
// Run from supabase/functions:
//   deno test rudo-chat/booking_test.ts --coverage=cov_profile
//   deno coverage cov_profile

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type BookingAction,
  type BookingState,
  looksLikeBookingMessage,
  parseStructuredAction,
  RESERVED_ACTION_PREFIX,
  runBookingTurn,
  type ServiceRow,
} from "./booking.ts";

type Opts = Parameters<typeof runBookingTurn>[0];

// ---------------------------------------------------------------- fixtures

const FREE: ServiceRow = {
  id: "svc-free",
  external_service_id: null,
  name: "Consultation",
  description: null,
  category: "consultation",
  is_paid: false,
  price: 0,
  currency: "ZMW",
};

const PAID: ServiceRow = {
  id: "svc-paid",
  external_service_id: null,
  name: "Ultrasound",
  description: null,
  category: "imaging",
  is_paid: true,
  price: 250,
  currency: "ZMW",
};

const READY: BookingState = {
  service_id: "svc-free",
  service_name: "Consultation",
  is_paid: false,
  price: 0,
  currency: "ZMW",
  clinic_id: "clinic-1",
  clinic_name: "Lusaka Clinic",
  clinician_id: "c1",
  clinician_name: "Nurse Banda",
  date: "2026-12-01",
  start_time: "09:00",
  end_time: "09:30",
  awaiting_confirmation: true,
  idempotency_key: "key-1",
};

const CLINICIAN = {
  id: "c1",
  display_name: "Nurse Banda",
  clinic_id: "clinic-1",
  clinic_name: "Lusaka Clinic",
};

// ----------------------------------------------------------------- helpers

const act = (a: unknown) => RESERVED_ACTION_PREFIX + JSON.stringify(a);

function ymd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
}

type RpcResult = { data?: unknown; error?: { code?: string } | null };

function fakeSupabase(
  opts: { clinics?: Array<{ id: string; name: string }>; rpc?: RpcResult } = {},
) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(_table: string) {
      const chain = {
        select: () => chain,
        not: () => chain,
        order: () => Promise.resolve({ data: opts.clinics ?? [] }),
      };
      return chain;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(opts.rpc ?? { data: null, error: null });
    },
  };
  return { client: client as unknown as Opts["supabase"], rpcCalls };
}

type FetchCall = { url: string; body: Record<string, unknown> };

async function withFetch(
  handler: (url: string, body: Record<string, unknown>) => unknown,
  run: (calls: FetchCall[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    return Promise.resolve(
      new Response(JSON.stringify(handler(url, body)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function directoryHandler(slots: Array<Record<string, unknown>>) {
  return (_url: string, body: Record<string, unknown>) =>
    body.action === "list" ? { clinicians: [CLINICIAN] } : { slots };
}

function opts(
  supabase: Opts["supabase"],
  message: string,
  priorState: BookingState,
  serviceCatalog: ServiceRow[] = [FREE, PAID],
  geminiApiKey: string | null = null,
): Opts {
  return {
    supabase,
    supabaseUrl: "https://example.supabase.co",
    authorization: "Bearer test-token",
    message,
    priorState,
    serviceCatalog,
    geminiApiKey,
    geminiModel: "gemini-test",
  };
}

const slot = (start: string, end: string, available = true) => ({
  start_time: start,
  end_time: end,
  is_available: available,
});

const geminiReply = (fields: Record<string, unknown>) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }],
});

// ------------------------------------------- parseStructuredAction / regex

Deno.test("parseStructuredAction reads a valid reserved action", () => {
  const parsed = parseStructuredAction(act({ type: "select_slot", index: 2 }));
  assertEquals(parsed, { type: "select_slot", index: 2 });
});

Deno.test("parseStructuredAction ignores ordinary chat messages", () => {
  assertEquals(parseStructuredAction("I want to book a scan"), null);
});

Deno.test("parseStructuredAction returns null for bad JSON or missing type", () => {
  assertEquals(parseStructuredAction(RESERVED_ACTION_PREFIX + "{not json"), null);
  assertEquals(parseStructuredAction(act({ index: 1 })), null);
  assertEquals(parseStructuredAction(act("just a string")), null);
});

Deno.test("looksLikeBookingMessage detects booking intent", () => {
  assert(looksLikeBookingMessage("I want to book an appointment", false));
  assert(looksLikeBookingMessage("Can I get a scan next week?", false));
  assert(looksLikeBookingMessage("I need to see a nurse at the clinic visit", false) === true);
});

Deno.test("looksLikeBookingMessage ignores unrelated health questions", () => {
  assertEquals(looksLikeBookingMessage("What should I eat in the second trimester?", false), false);
});

Deno.test("looksLikeBookingMessage is always true during an active booking", () => {
  assert(looksLikeBookingMessage("tomorrow please", true));
});

// -------------------------------------------------- structured user actions

Deno.test("cancel clears the booking state", async () => {
  const { client } = fakeSupabase();
  const result = await runBookingTurn(
    opts(client, act({ type: "cancel" }), { service_id: "svc-free" }),
  );
  assertEquals(result.action, null);
  assertEquals(result.state, {});
});

Deno.test("select_service with an unknown id keeps state and asks again", async () => {
  const { client } = fakeSupabase();
  const prior: BookingState = { stage: "collecting" };
  const result = await runBookingTurn(
    opts(client, act({ type: "select_service", service_id: "nope" }), prior),
  );
  assertEquals(result.reply, "That service is no longer available. Please choose another.");
  assertEquals(result.action, null);
  assertEquals(result.state, prior);
});

Deno.test("select_slot with a bad index is rejected", async () => {
  const { client } = fakeSupabase();
  const result = await runBookingTurn(
    opts(client, act({ type: "select_slot", index: 5 }), { candidate_slots: [] }),
  );
  assertEquals(result.reply, "That time is no longer available. Please choose another.");
  assertEquals(result.action, null);
});

Deno.test("select_clinic with an unknown clinic is rejected", async () => {
  const { client } = fakeSupabase();
  const result = await runBookingTurn(
    opts(client, act({ type: "select_clinic", clinic_id: "x" }), {
      candidate_clinics: [{ id: "clinic-1", name: "Lusaka Clinic" }],
    }),
  );
  assertEquals(result.reply, "That clinic is no longer available.");
});

// ------------------------------------------------------------ pipeline steps

Deno.test("with no service chosen, offers at most 6 service options", async () => {
  const catalog: ServiceRow[] = Array.from({ length: 8 }, (_, i) => ({
    ...FREE,
    id: `svc-${i}`,
    name: `Service ${i}`,
  }));
  const { client } = fakeSupabase();
  const result = await runBookingTurn(opts(client, "hello", {}, catalog, null));
  assertEquals(result.action?.type, "service_options");
  const action = result.action as Extract<BookingAction, { type: "service_options" }>;
  assertEquals(action.services?.length, 6);
  assertEquals(result.state.candidate_services?.length, 6);
});

Deno.test("reports no_clinics when the clinic list is empty", async () => {
  const { client } = fakeSupabase({ clinics: [] });
  const result = await runBookingTurn(
    opts(client, act({ type: "select_service", service_id: "svc-free" }), {}),
  );
  assertEquals(result.action, { type: "booking_error", error: "no_clinics", retryable: true });
});

Deno.test("offers clinic options when several clinics exist", async () => {
  const { client } = fakeSupabase({
    clinics: [{ id: "a", name: "Clinic A" }, { id: "b", name: "Clinic B" }],
  });
  const result = await runBookingTurn(
    opts(client, act({ type: "select_service", service_id: "svc-free" }), {}),
  );
  assertEquals(result.action?.type, "clinic_options");
  assertEquals(result.state.candidate_clinics?.length, 2);
});

Deno.test("a single available slot goes straight to a booking summary", async () => {
  const { client, rpcCalls } = fakeSupabase({
    clinics: [{ id: "clinic-1", name: "Lusaka Clinic" }],
  });
  await withFetch(directoryHandler([slot("9:00:00", "9:30:00")]), async () => {
    const result = await runBookingTurn(
      opts(client, act({ type: "select_service", service_id: "svc-free" }), {}),
    );
    assertEquals(result.action?.type, "booking_summary");
    const { summary } = result.action as Extract<BookingAction, { type: "booking_summary" }>;
    assertEquals(summary.serviceName, "Consultation");
    assertEquals(summary.isPaid, false);
    assertEquals(summary.startTime, "09:00");
    assertEquals(summary.clinicName, "Lusaka Clinic");
    assertEquals(summary.clinicianName, "Nurse Banda");
    assertEquals(summary.date, ymd(0));
    assertEquals(result.state.awaiting_confirmation, true);
    assertEquals(typeof result.state.idempotency_key, "string");
    assertEquals(rpcCalls.length, 0, "nothing is booked before the user confirms");
  });
});

Deno.test("several slots are listed in time order, then one can be selected", async () => {
  const { client } = fakeSupabase({
    clinics: [{ id: "clinic-1", name: "Lusaka Clinic" }],
  });
  await withFetch(
    directoryHandler([slot("10:00:00", "10:30:00"), slot("09:00:00", "09:30:00")]),
    async () => {
      const first = await runBookingTurn(
        opts(client, act({ type: "select_service", service_id: "svc-free" }), {}),
      );
      assertEquals(first.action?.type, "slot_options");
      const listed = first.action as Extract<BookingAction, { type: "slot_options" }>;
      assertEquals(listed.slots.map((s) => s.startTime), ["09:00", "10:00"]);

      const second = await runBookingTurn(
        opts(client, act({ type: "select_slot", index: 1 }), first.state),
      );
      assertEquals(second.action?.type, "booking_summary");
      const { summary } = second.action as Extract<BookingAction, { type: "booking_summary" }>;
      assertEquals(summary.startTime, "10:00");
    },
  );
});

Deno.test("slots that are not available are ignored", async () => {
  const { client } = fakeSupabase({
    clinics: [{ id: "clinic-1", name: "Lusaka Clinic" }],
  });
  await withFetch(
    directoryHandler([slot("09:00:00", "09:30:00", false)]),
    async () => {
      const result = await runBookingTurn(
        opts(client, act({ type: "select_service", service_id: "svc-free" }), {}),
      );
      assertEquals(result.action, {
        type: "booking_error",
        error: "no_availability",
        retryable: true,
      });
    },
  );
});

Deno.test("confirm before a summary was shown does not book", async () => {
  const { client, rpcCalls } = fakeSupabase();
  const notYetConfirmable: BookingState = { ...READY, awaiting_confirmation: undefined };
  const result = await runBookingTurn(
    opts(client, act({ type: "confirm" }), notYetConfirmable),
  );
  assertEquals(rpcCalls.length, 0);
  assertEquals(result.action?.type, "booking_summary");
});

// --------------------------------------------------------- Gemini extraction

Deno.test("Gemini-extracted service, day and time narrow the search", async () => {
  const { client } = fakeSupabase({
    clinics: [{ id: "clinic-1", name: "Lusaka Clinic" }],
  });
  const handler = (url: string, body: Record<string, unknown>) => {
    if (url.includes("generativelanguage")) {
      return geminiReply({
        intent: "book",
        service_query: "ultrasound",
        date_text: "tomorrow",
        time_text: "morning",
      });
    }
    return directoryHandler([slot("09:00:00", "09:30:00"), slot("14:00:00", "14:30:00")])(url, body);
  };
  await withFetch(handler, async (calls) => {
    const result = await runBookingTurn(
      opts(client, "ultrasound tomorrow morning", {}, [FREE, PAID], "test-key"),
    );
    assertEquals(result.action?.type, "booking_summary");
    const { summary } = result.action as Extract<BookingAction, { type: "booking_summary" }>;
    assertEquals(summary.serviceName, "Ultrasound");
    assertEquals(summary.isPaid, true);
    assertEquals(summary.price, 250);
    assertEquals(summary.startTime, "09:00", "afternoon slot is filtered out");
    const availabilityDates = calls
      .filter((c) => c.body.action === "availability")
      .map((c) => c.body.date);
    assertEquals(availabilityDates, [ymd(1)]);
  });
});

Deno.test("if Gemini fails, the user is asked which service they want", async () => {
  const { client } = fakeSupabase();
  const handler = () => {
    throw new Error("simulated network failure");
  };
  await withFetch(handler, async () => {
    const result = await runBookingTurn(
      opts(client, "I want to book a scan", {}, [FREE, PAID], "test-key"),
    );
    assertEquals(result.action?.type, "service_options");
  });
});

Deno.test("Gemini cancel intent clears the state", async () => {
  const { client } = fakeSupabase();
  await withFetch(() => geminiReply({ intent: "cancel" }), async () => {
    const result = await runBookingTurn(
      opts(client, "never mind", { service_id: "svc-free" }, [FREE], "test-key"),
    );
    assertEquals(result.state, {});
    assertEquals(result.action, null);
  });
});

Deno.test("Gemini confirm books only after a summary was shown", async () => {
  const handler = () => geminiReply({ intent: "confirm", confirm: true });

  // Summary already shown: confirm is honoured.
  const shown = fakeSupabase({ rpc: { data: [{ id: "appt-9", is_paid_snapshot: false }] } });
  await withFetch(handler, async () => {
    const result = await runBookingTurn(opts(shown.client, "yes", READY, [FREE], "test-key"));
    assertEquals(shown.rpcCalls.length, 1);
    assertEquals(result.action?.type, "booking_success");
  });

  // No summary yet: "yes" must not book.
  const unshown = fakeSupabase();
  await withFetch(handler, async () => {
    const prior: BookingState = { ...READY, awaiting_confirmation: undefined };
    const result = await runBookingTurn(opts(unshown.client, "yes", prior, [FREE], "test-key"));
    assertEquals(unshown.rpcCalls.length, 0);
    assertEquals(result.action?.type, "booking_summary");
  });
});

// ------------------------------------------------------------ real booking

Deno.test("confirm creates a free appointment through the booking RPC", async () => {
  const { client, rpcCalls } = fakeSupabase({
    rpc: { data: [{ id: "appt-1", is_paid_snapshot: false }], error: null },
  });
  const result = await runBookingTurn(opts(client, act({ type: "confirm" }), READY));

  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].name, "book_dawa_mom_appointment");
  assertEquals(rpcCalls[0].args.p_clinic_id, "clinic-1");
  assertEquals(rpcCalls[0].args.p_clinician_id, "c1");
  assertEquals(rpcCalls[0].args.p_appointment_date, "2026-12-01");
  assertEquals(rpcCalls[0].args.p_start_time, "09:00:00");
  assertEquals(rpcCalls[0].args.p_end_time, "09:30:00");
  assertEquals(rpcCalls[0].args.p_idempotency_key, "key-1");
  assertEquals(rpcCalls[0].args.p_service_id, "svc-free");
  assertEquals(rpcCalls[0].args.p_payment_method, "online");

  assertEquals(result.action?.type, "booking_success");
  const { appointment } = result.action as Extract<BookingAction, { type: "booking_success" }>;
  assertEquals(appointment.id, "appt-1");
  assertEquals(result.state, {});
});

Deno.test("a paid appointment returns payment_required with server-side price", async () => {
  const { client } = fakeSupabase({
    rpc: {
      data: {
        id: "appt-2",
        is_paid_snapshot: true,
        price_snapshot: 250,
        currency_snapshot: "ZMW",
        service_name_snapshot: "Ultrasound",
      },
      error: null,
    },
  });
  const result = await runBookingTurn(opts(client, act({ type: "confirm" }), READY));
  assertEquals(result.action?.type, "payment_required");
  const { appointment } = result.action as Extract<BookingAction, { type: "payment_required" }>;
  assertEquals(appointment.price, 250);
  assertEquals(appointment.serviceName, "Ultrasound");
  assertEquals(result.state, { appointment_id: "appt-2", stage: "awaiting_payment" });
});

Deno.test("a double-booked slot (23505) is retryable and resets confirmation", async () => {
  const { client } = fakeSupabase({ rpc: { data: null, error: { code: "23505" } } });
  const result = await runBookingTurn(opts(client, act({ type: "confirm" }), READY));
  assertEquals(result.reply, "That time was just taken. Would you like to try another time?");
  assertEquals(result.action, { type: "booking_error", error: "23505", retryable: true });
  assertEquals(result.state.awaiting_confirmation, false);
  assertEquals(result.state.idempotency_key, undefined);
});

Deno.test("an unknown database error is not retryable and clears the state", async () => {
  const { client } = fakeSupabase({ rpc: { data: null, error: { code: "XX000" } } });
  const result = await runBookingTurn(opts(client, act({ type: "confirm" }), READY));
  assertEquals(result.action, { type: "booking_error", error: "XX000", retryable: false });
  assertEquals(result.state, {});
});
