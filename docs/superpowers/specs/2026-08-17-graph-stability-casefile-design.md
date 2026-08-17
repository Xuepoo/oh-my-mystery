# Graph Stability and Lazy Casefile Design

## Context

OMM's graph currently treats every node press as the start of a drag. It pins the node at the pointer's world position and reheats the force layout before knowing whether the gesture is a click. Clicking a label therefore moves its node toward the label, wakes a settled graph, and causes visible jitter. Repeated movement also makes stale pixels look like trails.

The graph statistics panel and relationship filter use independent fixed coordinates, so text state can leak between draw calls and desktop filter pills can cover the left tool column. The casefile endpoint eagerly returns facts and recommendations, the drawer defaults to recommendations, and copied facts expose internal IDs instead of readable names.

This design covers GitHub issue #21 and CarryCtx task CTX-0058.

## Goals

- Keep ordinary mouse clicks and mobile taps position-stable and physics-neutral.
- Begin node dragging only after a movement threshold without an initial jump.
- Eliminate stale-pixel trails or produce an upstream-ready renderer reproduction if OMM is not responsible.
- Keep statistics and filters inside their responsive regions.
- Make the casefile profile-first, with lazy relations and recommendations.
- Show readable metadata instead of internal IDs.
- Let users click or tap any data row to copy only its value.
- Keep navigation separate from copy by using a dedicated arrow target.

## Non-Goals

- Replacing `@vectojs/graph-layout` or changing the graph's ownership model.
- Adding arbitrary user-editable metadata.
- Building a complete publication bibliography browser.
- Removing recommendations from the product.
- Converting the VectoJS canvas interface into HTML/CSS layout.

## 1. Pointer and Physics State

`App` will replace the current immediate `draggedNode` behavior with a pending-node gesture:

```ts
interface PendingNodeGesture {
  pointerId: number;
  node: GraphNode2D;
  pointerType: string;
  startScreenX: number;
  startScreenY: number;
  grabOffsetWorldX: number;
  grabOffsetWorldY: number;
  dragging: boolean;
}
```

Only the primary pointer may create a pending node gesture. On `pointerdown`, OMM records its pointer ID, the node, pointer position, the offset from the pointer's world position to the node's current center, and whether the node was permanently pinned before the gesture. It captures that pointer on the canvas. Secondary pointers cancel the pending node gesture before beginning pinch handling, and events whose pointer ID does not own the gesture cannot move, release, or activate the node. Mouse and pen use the same threshold and activation rules; non-primary buttons never begin a node gesture.

On `pointermove`, dragging begins only when movement exceeds 6 logical pixels for a mouse/pen or 10 logical pixels for touch. On the threshold-crossing event, the node is first temporarily pinned at its existing center, then moved once to `currentPointerWorld + recordedGrabOffset`; subsequent moves use the same expression. A drag that begins on a label therefore has no snap discontinuity.

On `pointerup` below the threshold, the gesture remains a click/tap and opens the casefile without any layout operation. On release after a drag, a node that was permanently pinned before the gesture remains pinned at its new position; otherwise only the drag-owned temporary pin is removed. The layout receives recovery alpha `0.08`. Pointer cancellation restores the pre-gesture permanent pin state and original coordinates, releases pointer capture, and never opens a casefile.

Hover pin, drag pin, and permanent pin are separate owners. A node is physically pinned while any owner exists. Starting a drag clears only that node's hover owner; ending or cancelling a drag removes only drag ownership. Hover inspection may temporarily pin a moving node but must not reheat a settled layout. Permanent pin toggles do not modify transient ownership.

## 2. Jitter and Ghosting

The first correction is removing click-induced reheat. Expansion, topology mutation, explicit relayout, and actual drag release remain legitimate layout wakeups.

`BackgroundLayer.render()` will wrap its work in `ctx.save()`/`ctx.restore()`. Inside that boundary it will call `ctx.resetTransform()` when available, otherwise set the identity transform, then set:

- identity transform
- `globalAlpha = 1`
- `globalCompositeOperation = 'source-over'`
- zero shadow blur/offset

Clipping cannot be reset by property assignment, so every OMM render method touched by this work must own balanced `save()`/`restore()` calls; the background's initial full-canvas paint runs before any graph-layer clip is established. The background remains an opaque full-viewport redraw.

A deterministic Canvas2D test at DPR 1 draws only a solid test background and geometric node, moves it from frame N to N+1, then samples a pixel at least two pixels inside the old node footprint and requires exact background RGBA. A headed browser regression runs the same geometry at DPR 2 with a one-channel tolerance of 2 to account for device compositing, avoiding text, shadows, images, and antialiased boundaries. Canvas is the required backend for this gate because it is OMM's node/edge renderer. If OMM's state-isolated reproduction passes but a minimal VectoJS scene fails, filing an upstream issue with that reproduction is an acceptable blocker, not task completion; OMM will not ship until the production path is clean.

Layout acceptance tests will assert that a click on a settled graph does not make `isSimulating()` true and does not alter node coordinates. Drag tests will assert threshold, preserved grab offset, movement, and release behavior.

## 3. Statistics Terminology and Layout

The statistics modal keeps six cards but renames `全库事实` to `全库关系/属性`. The label means rows in the D1 `facts` table, including entity relations and scalar metadata such as ISBN and publication date. `当前关系` continues to mean links materialized in the current subgraph.

Every modal section explicitly sets `textAlign` and `textBaseline` before drawing. The node-type heading uses left alignment and the type chart is clipped to the modal's content rectangle. Card and chart coordinates derive from modal width and column count; tests cover desktop, narrow mobile, and representative 125%/150% logical viewport sizes.

## 4. Relationship Filter Layout

On desktop widths of at least 640 logical pixels, expanded filter pills begin immediately to the right of the `关系` toggle and wrap within the remaining scene width. They never occupy the left tool column below the toggle. Graph statistics, visibility, clear, and history controls retain that column.

Below 640 pixels, pills retain a compact grid beneath the toggle. Hit rectangles derive from the same layout calculation used for rendering, so visual and pointer geometry cannot diverge.

## 5. Casefile Data Boundaries

The new frontend contract uses three bounded endpoints:

- `GET /api/entity/:id/profile`
- `GET /api/entity/:id/relations?limit=30&cursor=<opaque>`
- `GET /api/entity/:id/recommendations`

All return JSON. Missing entities return `404 { error: 'Entity not found' }`. Invalid `limit` or cursor returns `400 { error: string }`. Unexpected database failures retain the global `500` JSON contract. `limit` is clamped to 1 through 60 and defaults to 30. The already shipped `GET /api/entity/:id/details` remains unchanged as a compatibility endpoint for this release, but OMM web stops importing its response type or calling it. No new behavior depends on `/details`.

The response types are:

```ts
interface EntityProfileResponse {
  entity: OmmEntity;
  fields: ProfileField[];
}

interface ProfileField {
  key: string;
  label: string;
  value: string;
  copyValue: string;
  targetId?: string;
}

interface EntityRelationsResponse {
  entityId: string;
  items: RelationItem[];
  nextCursor?: string;
}

interface RelationItem {
  predicate: string;
  label: string;
  value: string;
  copyValue: string;
  targetId?: string;
  direction: 'outgoing' | 'incoming';
}

interface EntityRecommendationsResponse {
  entityId: string;
  items: CasefileRecommendationItem[];
}

interface CasefileRecommendationItem {
  targetId: string;
  name: string;
  type: EntityType;
  score: number;
  reason: string;
}
```

The profile endpoint resolves referenced author, publisher, translator, award, series, and similar profile fields through a bounded batch query against `entities`. Scalar values remain scalar. Internal identifiers are not user-facing fallback text: unresolved references are omitted from profile fields and may be logged or counted for data-quality diagnostics.

Source prefixes are mapped to readable provenance names such as Wikidata, 豆瓣, 日本国会图书馆, 青空文库, Project Gutenberg, and OMM. The profile response does not expose the raw source ID as a displayed field.

For an outgoing fact (`subject_id` equals the selected entity), an entity relation uses `object_ref` as `targetId`; its resolved label is both `value` and `copyValue`. For an incoming fact (`object_ref` equals the selected entity), `subject_id` is `targetId`; its resolved label is the value. A fact is scalar when `object_ref` does not resolve to an entity and `object_value` is non-empty; it has no `targetId` and uses `object_value` as its value. Rows with neither a resolved counterpart nor a scalar value are omitted. Direction is always retained in the response.

Relations sort by `predicate ASC, direction ASC, value ASC, fact id ASC`. The opaque cursor encodes the complete final sort tuple; the next request uses strict tuple comparison, preventing duplicates across pages. A malformed cursor returns 400. Recommendations sort by `rank ASC, target_id ASC` and are bounded to ten items. These endpoints are requested independently.

## 6. Casefile Tabs and Request State

The drawer has `档案`, `关系`, and `推荐` tabs and always opens on `档案`. Opening a node requests only its profile. Relations and recommendations use per-tab state:

```ts
type LazyTabState<T> =
  | { status: 'idle' }
  | { status: 'loading'; epoch: number }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };
```

The first activation starts its request and shows a centered spinner plus `正在加载关系…` or `正在加载推荐…`. Ready values are cached only while that entity remains in the open drawer. Closing the drawer or opening any entity, including the same entity again, creates a fresh epoch and discards all tab caches. Switching tabs does not refetch. Retry replaces an error state with a new loading epoch.

Relation state additionally stores accumulated pages, `nextCursor`, and a page-loading/error state. `加载更多` requests the next cursor once, appends items by stable identity, and preserves already loaded rows if a later page fails; the error appears beside a retry-more action. Responses from stale drawer or page epochs are ignored.

Each tab owns an independent scroll position that is preserved while switching tabs during one drawer session. A newly opened entity starts all positions at zero.

Empty states are explicit: profile with no optional fields shows `暂无更多档案信息`, relations shows `暂无可展示关系`, and recommendations shows `暂无推荐`.

The `VERIFIED ARCHIVE` seal is removed. Header controls remain sticky. The content region scrolls as a single owner, and changing tabs resets that tab's scroll position.

## 7. Copy and Navigation Interaction

Every displayed profile field has one row hit target. A mouse click or mobile tap copies `copyValue`, never the label. For example, activating `ISBN：9787569930979` copies only `9787569930979`. The row shows `已复制` for 1.5 seconds. Clipboard failure shows `复制失败` for 1.5 seconds without closing the card.

A row press is a pending activation. Movement beyond 6 logical pixels for mouse/pen or 10 for touch cancels copy and transfers ownership to drawer-content scrolling. Pointer cancellation also cancels copy. Releasing within the threshold copies once. This prevents touch scrolling from copying fields accidentally.

The card's top copy button copies all profile fields in display order as `标签：值`, one field per line, omitting empty fields and placing no blank trailing line. It never triggers relations or recommendations and behaves the same regardless of the active tab.

Relation and recommendation text uses the same click/tap-to-copy behavior. A separate right-side arrow with at least a 44 by 44 logical-pixel touch target opens the target entity. Clicking the arrow never copies. Rows without a resolvable target omit or disable the arrow.

The card's lower-right hint reads `点击字段即可复制`. The hint itself is not interactive.

Canvas remains authoritative. Native text selection is not enabled because it conflicts with row-level tap/click copy and canvas drag routing. VectoJS content projection may expose non-selectable semantic text for accessibility in a later task, but it is not required for this interaction.

## 8. Rendering and Responsive Geometry

The casefile remains a VectoJS `Entity` drawn on Canvas. Geometry is calculated in logical pixels from `scene.width` and `scene.height`:

- desktop card width: up to 420 pixels
- mobile card: viewport width minus 32 pixels
- tab widths: equal within the inner content width
- copyable rows: minimum 44-pixel hit height
- navigation arrow: minimum 44-pixel square target
- spinner: centered in the content region, not the entire scene

All visible and interactive rectangles are generated by the same layout pass. The drawer header background supports card dragging only for the primary mouse/pen pointer; mobile touch does not drag the card. Tabs, header buttons, content rows, retry/load-more controls, scroll content, and navigation arrows are excluded from card-drag initiation. Each gesture has one pointer owner. Crossing a drag or scroll threshold suppresses release activation and any subsequent synthetic click.

## 9. Error Handling

- Profile load failure keeps the casefile shell open and presents retry; it does not show stale data from the prior node.
- Lazy-tab failures affect only that tab.
- Malformed JSON is treated as a tab-specific failure with retry.
- Invalid or expired relation cursors keep loaded rows and offer retry from the last accepted cursor; a repeated 400 resets relation pagination and reloads page one.
- A relation page database failure keeps loaded pages visible and retries only the failed page.
- Clipboard unavailability or rejection produces row/button error feedback.
- Missing labels use another human-readable language label; raw entity IDs are not displayed as the final fallback in profile, relation, recommendation, or copy content.
- Cursor requests ignore duplicates and stale entity epochs.

## 10. Verification

Unit and API tests will cover:

- click/tap coordinate stability and no physics wakeup
- drag threshold, grab offset, cancellation, permanent pin interaction, and low-alpha release
- hover pin without reheat
- complete redraw of a node's old location
- statistics terminology, alignment state, clipping, and responsive geometry
- desktop-right and mobile-grid relationship filter geometry and hit testing
- profile ID resolution and readable source names
- profile-only initial request
- one request per lazy tab, caching, stale-response rejection, retry, and per-tab scroll
- centered loading state and empty states
- field value copy, full-profile copy, mobile tap copy, error feedback, and feedback reset
- touch scrolling beginning on a field does not copy
- separate arrow navigation and 44-pixel touch target
- no eager relations/recommendations request

The final gate includes `oxfmt`, `oxlint`, all Bun tests, production build, Playwright interaction tests in headed Chrome and Firefox, mobile viewport/touch coverage, `git diff --check`, and production smoke checks after merge.
