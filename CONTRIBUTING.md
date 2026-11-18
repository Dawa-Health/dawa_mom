# Contributing to DawaMom

Thank you for helping to improve DawaMom. Corrections and additions are welcome, especially from first-language speakers, clinicians and people who use the app.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a problem.** A bug, a wrong or unsafe statement in pregnancy-week guidance, a mistranslation, text in the wrong language, a missing accessibility label.
- **Correct existing content.** Fix a translation, a pregnancy-week fact or a label.
- **Add content.** A new language, or better translations for an existing one.
- **Improve the app.** Features, tests, documentation and Supabase checks.

You do not need to write code to contribute. If you are not comfortable with Git, open an issue describing the correction, or email developers@dawa-health.com, and a maintainer will make the change and credit you.

## Rules for all contributions

- **No personal or patient information.** Never include names, phone numbers, appointments, period tracker entries, Rudo conversations or case details from real people, even if de-identified. Use made-up data in examples, screenshots and test data.
- **No private keys in the app.** The Supabase URL and anon key are public and are checked in. Gemini, ElevenLabs, service-role and backend keys belong in Supabase Edge Function secrets or backend environment variables, never in Flutter code or the repository.
- **Only share what you have the right to share.** Do not copy text, images or code from books, websites, guidelines or other apps unless their license allows it. Say where information came from.
- **Health content must be accurate and safe.** Base pregnancy-week guidance and other health content on current national or WHO guidance, and say which in the pull request.
- **Local-language content must be written or checked by a first-language speaker.** Do not submit unreviewed machine translation. Clinical and long-form educational translations need qualified native-language review before public-health release.

## Reporting a problem

Open an issue and include:

- the screen, the language and the pregnancy week, if it applies;
- what is wrong;
- what it should say or do, if you know;
- your platform (Android, iOS or web);
- a source, for clinical corrections.

For a security vulnerability, or personal information that has been published by mistake, do not open a public issue. Email developers@dawa-health.com.

## Making a change

Nobody commits directly to `main`. All changes go through a pull request.

1. Open an issue first for anything larger than a small correction, so it can be discussed before you do the work. Adding a language, changing pregnancy-week guidance, or changing the Supabase schema or RLS policies always needs an issue.

2. Fork the repository and create a branch. Name it after the change:

   ```
   git checkout -b fix/period-tracker-cycle-length
   git checkout -b add/lozi-appointment-copy
   git checkout -b docs/web-preview
   ```

3. Make the change. See "Working on the code" below.

4. Run the checks on your machine:

   ```
   flutter pub get
   flutter analyze --no-pub
   flutter test --no-pub
   ```

5. Commit with a short message that says what changed and where:

   ```
   Fix Bemba label on appointment confirm button
   ```

6. Open a pull request against `main`. Say what changed, why, and how you tested it, and link the issue it resolves.

7. Respond to review. Push further commits to the same branch. A maintainer merges the pull request once it is approved and the checks pass.

## Working on the code

- **Supabase only.** The app runs on Supabase Auth, Postgres, Row Level Security and Edge Functions. The Firebase files still in the repository are not used by the app, so do not build on them. Some migrations keep Firebase names because they import old data.
- **User-facing text goes in the language catalog.** Add every new string for all five languages (English, Nyanja, Bemba, Tonga and Lozi) rather than hard-coding it. This covers navigation, screen copy, forms, validation messages, accessibility labels, date and time controls, and Rudo. If you cannot provide a language, say so in the pull request so a language reviewer can add it.
- **Schema changes go in a new migration in `supabase/`.** Do not edit a migration that has already been applied.
- **Keep changes small.** One language or one kind of fix per pull request is easier to review.

### Supabase changes

Apply all migrations before testing:

```
supabase db push --linked
```

Then run `supabase/POST_MIGRATION_VERIFY.sql` and the owner, non-owner and anonymous checks in `supabase/APPOINTMENTS_RLS_VERIFY.sql`.

After changing Supabase-facing code, check:

- auth sign-in and the Firebase password migration fallback;
- `period_tracker_settings` and `period_tracker_entries` reads and writes;
- `rudo-chat` Edge Function invocation and chat history persistence;
- RLS policies for the patient, doctor and admin roles.

DawaMom shares appointments, clinician data and RLS policies with Dawa Clinician. Test changes to shared tables, RPCs or policies from both apps. Do not change the interface in `docs/dawa-clinician-integration-contract.md` without an issue that both projects have agreed on.

## Adding a language

Open an issue first. The proposal should name the translators, the first-language reviewer and a clinician who can check health content in that language. A new language must cover every string in the bundled catalog, so the whole app works in it. Add the language to the Languages section of the README and list its translators there.

## Review and approval

| Change | Approvals needed |
| --- | --- |
| Documentation, tests and code | One maintainer |
| Health content, including pregnancy-week guidance | One maintainer and one clinical reviewer |
| Content in a local language | One maintainer and one language reviewer for that language |
| Supabase schema, RLS policies and shared tables | One maintainer, after testing from both DawaMom and Dawa Clinician |

A change that falls under more than one row needs all of those approvals. Reviewers check that the content is accurate and safe, reads naturally in its language, contains no personal information or private keys, and does not weaken how health data is protected. Maintainers aim to give a first response within seven days.

## Credit

Contributors are credited through their commits. When a maintainer makes a change for you from an issue or an email, they credit you as a co-author. Translators of each language are listed in the README.

## License

The project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). By submitting a contribution you agree that it is licensed under the same terms, and you confirm that you have the right to submit it. Third-party dependencies keep their own licenses. Datasets released by Dawa Health and the Rudo model weights have their own terms.

## Questions

Open an issue, or email developers@dawa-health.com.
