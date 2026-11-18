# DawaMom Project Charter

This charter describes what the DawaMom project is for, what it covers, who is responsible for it and how decisions are made. It applies to everything in this repository.

## 1. Mission

DawaMom exists to give women a maternal health companion they can trust, in their own language. It offers pregnancy guidance, period tracking, appointments with clinicians and answers from Rudo, and keeps their health data private.

## 2. Goals

- Give accurate pregnancy-week guidance, reviewed by clinicians.
- Work fully in English, Nyanja, Bemba, Tonga and Lozi, with content written or reviewed by first-language speakers.
- Keep working on a poor connection, with a bundled language catalog that works offline.
- Make it easy to request appointments with clinicians who use Dawa Clinician.
- Let women track their periods and keep that data private.
- Work with screen readers and other assistive technology.
- Keep the code open and documented.

## 3. Scope

**In scope**

- The Flutter app (`lib/`) and its platform projects.
- The language catalog for every supported language.
- Supabase migrations, Edge Functions and verification SQL (`supabase/`).
- The Python Rudo backend code in `lib/backend`.
- Tests, documentation and tools such as the web preview server.
- New languages, new health content and corrections to existing content.

**Out of scope**

- Personal, patient or user data of any kind, including de-identified conversations.
- Model weights and training. Rudo's models are published separately and have their own terms.
- Dawa Clinician, which has its own repository. The tables, functions and contract the two apps share are agreed between both projects.
- New work on the old Firebase backend, other than migrating old data.
- Medical advice. DawaMom is not a medical device and does not replace professional medical advice, diagnosis or treatment.
- Content that Dawa Health or the contributor does not have the right to share.

## 4. Principles

- **Clinical accuracy first.** Health content is reviewed by a qualified health professional before it is merged.
- **Language authority.** Content in a language is written or reviewed by a first-language speaker. Code-switching with English is kept where speakers use it.
- **Privacy.** Nothing that could identify a person is accepted into the repository. User data is protected by Row Level Security, and private keys stay out of the app.
- **Works for everyone.** Every screen works in every supported language and with accessibility labels, and the app keeps working offline where it can.
- **Openness.** The code and its history are public. Known problems are recorded in the README, not hidden.

## 5. Roles and responsibilities

| Role | Responsibilities |
| --- | --- |
| Project steward (Dawa Health) | Owns the repository, holds the copyright, sets direction and appoints maintainers. |
| Maintainers | Review and merge pull requests, cut releases, keep documentation and tests current, and enforce this charter and the Code of Conduct. |
| Clinical reviewers | Check pregnancy-week guidance and other health content for accuracy and safety. At least one must approve any change to health content. |
| Language reviewers | Check content in their first language for correctness and natural wording. At least one must approve any change to that language's content. |
| Contributors | Anyone who opens an issue or pull request. Contributors follow the contributing guide and the Code of Conduct. |

Current maintainers and reviewers:

| Name | Role | Area |
| --- | --- | --- |
| Tariro F. Munzwa | Maintainer | Repository and releases |
| Tafadzwa. K Munzwa, MD | Clinical reviewer | Health content |
| Kudzai Mwedzi| Language reviewer | Nyanja, Bemba, Tonga and Lozi content |

The translators of each language are listed in the README.

## 6. Decision making

- Day-to-day changes are decided by pull request review. A change is merged when it has the approvals in section 7 and the checks pass.
- Maintainers aim for consensus. If maintainers cannot agree, the project steward decides.
- Larger changes need an issue for discussion first, open for at least seven days. These include adding a language, changing the tables, functions, RLS policies or integration contract shared with Dawa Clinician, and changing the license.
- Changes to anything shared with Dawa Clinician are agreed with the Dawa Clinician maintainers before they are merged.
- An urgent fix for a safety, security or privacy problem can be merged without the seven-day wait. It is discussed in an issue afterwards.
- Clinical disagreements are settled by the clinical reviewers, with reference to current national and WHO guidance. Where guidance differs between countries, the content says which it follows.

## 7. How changes are made

1. Open an issue describing the problem or proposal, unless the change is a small correction.
2. Create a branch and make the change. Nobody commits directly to `main`.
3. Open a pull request that says what changed, why, and how it was tested.
4. Run `flutter analyze` and `flutter test`, and the Supabase checks for any Supabase change.
5. Review and approval:
   - any change: one maintainer;
   - health content: one maintainer and one clinical reviewer;
   - content in a local language: one maintainer and one language reviewer for that language;
   - Supabase schema, RLS policies and shared tables: one maintainer, after testing from both DawaMom and Dawa Clinician.
6. A maintainer merges the pull request.

Details are in [CONTRIBUTING.md](CONTRIBUTING.md).

## 8. Quality

- Every pull request passes `flutter analyze` and `flutter test`.
- After migrations are applied, Supabase changes are verified with `supabase/POST_MIGRATION_VERIFY.sql` and `supabase/APPOINTMENTS_RLS_VERIFY.sql`.
- Known issues, such as translations still waiting for qualified native-language review, are listed in the README until they are fixed.
- Corrections from first-language speakers and clinicians are treated as a priority.

## 9. Releases

- Releases use version numbers of the form MAJOR.MINOR.PATCH.
  - MAJOR: a change that needs a data migration, or that breaks compatibility with Dawa Clinician.
  - MINOR: new features, languages or content.
  - PATCH: fixes, corrections and documentation.
- Each release has a tag and an entry in `CHANGELOG.md`.
- A language is not part of a public-health release until its clinical and long-form educational content has had qualified native-language review.

## 10. License and contributions

The project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). Copyright is held by Dawa Health. Contributions are accepted under the same license, and contributors confirm they have the right to share what they submit. Datasets released by Dawa Health and the Rudo model weights have their own terms.

## 11. Code of Conduct

Everyone taking part in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Reports go to developers@dawa-health.com.

## 12. Funding and independence

Where the project receives outside funding, funders do not decide what is merged; that is decided through the process in this charter.

## 13. Changes to this charter

Changes to this charter or to the Code of Conduct are proposed by pull request, discussed in an issue for at least seven days, and approved by the project steward.

## Contact

developers@dawa-health.com
