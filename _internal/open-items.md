# SCI Dashboards — Open Items

*Internal only — not served (see root `_redirects`). Lives in the repo so it stays current via the normal pull/push flow: Claude pulls it at the start of a session, edits it, John commits. Started fresh 2026-06-13; older history lives in the legacy `SCI_Dashboards_Open_Items.md` (last updated 2026-04-29) and the Project Context / Developer SOP docs.*

---

## Shipped this session (2026-06-13)

### Sunrise Investment Dashboard — LTV rework (v33 → v34)

**Context:** A never-rendered "second v32" (Fund 3 backfill removal) was pushed with a colliding version number. The real GitHub v32 already contained the Fund-3-free, date-based per-contact LTV logic. Resolved by building forward.

**v33 — LTV regrouped by investment-record email.**
- `computeLTV` groups investments by the Investment record's own `email_address` (lowercased/trimmed) instead of contact association, so investments never linked to a contact still count. Blank-email records form `__noemail__<id>` singleton groups so **Total investments** reconciles with the top Funded KPI.
- Added `email_address` to `IPROPS`.
- Within each investor, sorted by `funds_received` — earliest = first, rest = follow-on (date-derived, not `type_of_investment`).
- Replaced the dead **First-time investors** card (it equalled Total investors) with **Repeat investors** (`count > 1`), drilling via `ddLtvRepeat()` into just those investors' investments.
- Bucket charts cache investment IDs directly (dropped the `INV_CONTACT_MAP` round-trip) so the bucket drill survives the regroup.
- `.ltv-krow` grid `repeat(6,1fr)` → `repeat(4,1fr)` so each row of four fills the full width.
- Section header, on-dash note, sublines, and guide LTV block reworded to email-grouping.

**v34 — Tier 1 canonical-investor grouping.**
- `fetchContactSources` also pulls `email` + `hs_additional_emails`; builds `EMAIL_TO_CONTACT` (primary + HubSpot-linked additional emails → contactId).
- `computeLTV` resolves each investment to a canonical investor: contact association → `EMAIL_TO_CONTACT[email]` → raw email → no-email singleton. Multi-email investors HubSpot has already linked merge into one; their later investments become follow-on, raising per-investor LTV.
- Graceful no-op when `hs_additional_emails` is empty (behaves like v33). "See what happens" — if Total investors / Repeat / avg LTV don't move after deploy, the field isn't populated and Tier 2 is the only lever.
- On-dash note + guide derivation paragraph + Total investors definition reworded to canonical-investor framing.

**Watch after deploy:** Total investors should dip (merges collapse dupes), Repeat investors tick up, per-investor LTV/avg rise — proportional to how populated `hs_additional_emails` actually is.

---

## Open / deferred

### Investor identity resolution — Tier 2 (ops practice, NOT code)
- **Problem Tier 1 doesn't solve:** the same human funding under two emails on records HubSpot never cookied together still counts as two separate investors, splitting their timeline and understating per-investor LTV.
- **Why not in code:** merging unlinked records needs fuzzy matching (name/phone/address). On money records a false merge combines two investors' capital into a headline figure — too risky to automate.
- **The practice:** when IE/ops spot an investor with investments under two emails (or obvious duplicate contacts), merge the contact records in HubSpot. Merging populates `hs_additional_emails`, which Tier 1 reads automatically — LTV self-corrects, no code change. Keeps Tier-2-in-code unnecessary.
- **Status:** Tier 1 shipped (sunrise-v34). Tier 2 is ongoing data hygiene — needs to be communicated to the IE team.

### Verify `hs_additional_emails` is populated — CHECKED 2026-06-13: sparse
- Tier 1's payoff depends on this field carrying data. **Result after deploying v34: it's barely populated.** Tier 1 caught exactly one returning investor (a multi-email merge), nudging LTV / first-investment from 1.94x → 1.95x. v34 render: 912 investors, 1,764 investments, $258.80M portfolio LTV, 1.95x.
- Conclusion confirmed: Tier 1 works as designed, but the data gives it almost nothing to catch. The real LTV recovery lives in **Tier 2** — ops merging duplicate investor contacts in HubSpot. As those merges happen, `hs_additional_emails` populates and this number climbs on its own with no code change.

### ~~ga4.html stray copy at repo root~~ — RESOLVED 2026-06-13
- A stale `ga4.html` (v2) sat at the repo root from an earlier misupload, outside the `/d/*` Access gate and 11 versions behind the real `/d/ga4.html` (v13). Deleted from the repo. The gated, current GA4 dashboard lives only at `/d/ga4.html`. After redeploy, confirm `…/ga4.html` 404s and the hub's Web Traffic card still opens `/d/ga4`.

---

## Notes / conventions
- Open-items doc now lives at `/_internal/open-items.md`, 404'd from the deployed site via root `_redirects`. Pull it at session start; John commits edits (PAT is read-only for writes).
- Legacy backlog (pre-2026-04-29 detail, hybrid-snapshot/CDC design, rankings, KPI goals, shared-lib, etc.) remains in `SCI_Dashboards_Open_Items.md` — port items forward here as they become active.
