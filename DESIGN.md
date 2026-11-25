# Approved warm farm-management interface
Reference: the owner-approved LivestockOS dashboard mockup supplied November 21, 2026. This is an operating interface, with real data and accessible task controls.

Use warm background #F6F4EC, forest sidebar #203C32, surface #FCFBF7, primary text #242923, olive #87947A and border #E7E3D8. Secondary text is darkened to #656960 for readable contrast. Terracotta is reserved for overdue information.

Desktop uses a 240 px sidebar, 32 px content gutters, 24 px section gaps and 24 px card padding. Four live metrics precede attention and quick-action sections, then upcoming activity and species distribution. Recent records remain available below. Georgia headings echo the mockup; self-hosted Inter carries data, labels and forms. Authored SVG icons share a consistent stroke.

On 390 px screens, metrics wrap to two columns, content becomes one column, cards use 18 px padding, and five primary destinations sit in the bottom navigation. A sticky header holds a 44 px **Menyja / Menu** button, the LivestockOS mark and reminders. The menu opens a left panel listing every page for the role (current page highlighted), the signed-in account, language and sign out; it closes on a page choice, the backdrop or Escape and returns focus to the button. A Vet also sees a small "Vetëm lexim" badge in the header. On desktop the same account controls sit at the bottom of the sidebar. A phone held in landscape (height up to 500 px) uses the same bottom navigation instead of a clipped sidebar. Touch controls are at least 44 px.

All counts and dates come from the existing repositories. Empty states are explicit. Vet sees information without mutation actions. Session, reconciliation, conflict and offline safeguards are retained.

Hierarchy: the page title comes first, then its actions, then sections. Each section has one solid primary action; supporting actions are outlined; disabled actions are flat grey so they never read as primary. The one-time "Të dhënat e fermës" step is a compact notice above the page, and its full section lives in Settings below Accounts. Admin creates or changes the Vet account from **Cilësimet → Llogaritë**; the form opens as a dialog (a bottom sheet on phones).
