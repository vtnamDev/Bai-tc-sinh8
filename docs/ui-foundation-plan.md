# BioSphere Slides — UI foundation and performance plan

Date: 2026-10-15  
Branch: `work/biosphere-ui-foundation`

## Current technical baseline

- Static site: `index.html`, `styles.css`, `editorial-light.css`, `app.js`, `bai32-deck.js`, `model-embed.js`, and a service worker.
- The lesson contains 25 slides, five digestive-health topics, five case questions, five 3D entry points, and an eight-person Tổ 4 slide. Keep the verified learning sequence and factual content intact while improving presentation.
- The UI defaults to a warm light theme. The new `workspace-polish.css` is a small, layered design pass; it intentionally avoids another UI framework, remote font dependency, large illustration pack, or extra runtime library.
- The project already has automatic performance profiles, reduced-motion support, lazy 3D activation, adaptive image handling, and an HDMI/TV projector mode. Preserve these controls rather than duplicating them.

## Design direction

Use an editorial science workspace: paper white and warm cream as the canvas, pale gold as the accent, readable dark-brown text, subtle card borders, soft depth and small friendly details. Cute elements should behave like annotations or stickers—not compete with lesson content. The animal SVG avatars remain the identity system for all eight team members.

The presentation viewer remains a separate product surface from the library: cinematic chapter transitions and selected 3D scenes may be expressive, but labels, sources, captions, questions and contrast must stay readable on an HDMI-connected TV.

## Implementation sequence

1. **Foundation (this branch):** add a small CSS polish layer, make the primary above-the-fold image eligible for eager/high-priority loading, synchronize static-asset cache keys and service-worker shell cache, add regression checks, document the build plan, and retire the failed Netlify deploy workflow from the proposed release branch.
2. **Quality pass:** validate at 360–390 px mobile widths, 720 px CSS viewport, laptop landscape, and a 16:9 projector viewport. Review title wrapping, source readability, focus visibility, quiz feedback, the eight-card team grid, and fullscreen controls.
3. **Performance pass:** record Lighthouse or equivalent before/after when a browser runner is available. Target an LCP under 2.5 s on a good mobile connection, CLS under 0.1, and no horizontal overflow. Keep third-party MP4/GLB assets out of the initial critical path; start videos only when eligible and load 3D only after a deliberate user action.
4. **Content and accessibility pass:** re-check the five disease chapters and source links against the KHTN 8 source plus authoritative medical references. Verify keyboard navigation, meaningful image alternatives, visible focus, and `prefers-reduced-motion`.
5. **Release:** first review the branch preview and static validation; then merge/deploy through Vercel. Keep the old Netlify URL available until the Vercel production URL is confirmed healthy. Only after verification should Netlify be treated as retired.

## Guardrails

- Do not rewrite the full application just for a visual change.
- Do not add a heavy animation engine or auto-playing background video to the library.
- Prefer CSS transforms/opacity over continuous layout animation; stop decorative motion in reduced-motion and low-power modes.
- Never claim a performance improvement from appearance alone: measure it with repeatable tests.
- Do not claim that localStorage sharing is server-synced or password-protected. The existing settings correctly disclose those limitations.
- The release is accepted only when static validation passes, the 25-slide and five-quiz invariants hold, cache versions match, and no production deployment has been switched before review.
