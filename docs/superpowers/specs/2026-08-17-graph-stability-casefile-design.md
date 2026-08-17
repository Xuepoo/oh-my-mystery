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
  node: GraphNode2D;
  pointerType: string;
  startScreenX: number;
  startScreenY: number;
  grabOffsetWorldX: number;
  grabOffsetWorldY: number;
  dragging: boolean;
}
```

On `pointerdown`, OMM records the node, pointer position, and the offset from the pointer's world position to the node's current center. It does not pin, reheat, or move the node.

On `pointermove`, dragging begins only when movement exceeds 6 logical pixels for a mouse/pen or 10 logical pixels for touch. The first and subsequent drag coordinates preserve the recorded grab offset, so a drag that begins on a label does not snap the node center to the pointer. Entering drag pins at the node's current position; subsequent moves update the pin.

On `pointerup` below the threshold, the gesture remains a click/tap and opens the casefile without any layout operation. On release after a drag, the temporary pin is removed unless the node is permanently pinned. The layout receives only a low recovery alpha sufficient to settle local forces. Pointer cancellation rolls back temporary pin state and never opens a casefile.

Hover inspection may temporarily pin a moving node but must not reheat a settled layout. Permanent pin toggles also remain independent from transient drag and hover pins.

## 2. Jitter and Ghosting

The first correction is removing click-induced reheat. Expansion, topology mutation, explicit relayout, and actual drag release remain legitimate layout wakeups.

OMM will make frame state explicit before drawing its full-screen background:

- identity transform
- `globalAlpha = 1`
- `globalCompositeOperation = 'source-over'`
- no inherited shadow or clipping state

The background remains an opaque full-viewport redraw. A deterministic renderer test will draw a moving node at frame N and N+1 and assert that pixels at the old position match the background after N+1. If trails remain with an opaque redraw and isolated state, the implementation will create a minimal VectoJS reproduction and upstream issue rather than adding a translucent cover that hides the defect.

Layout acceptance tests will assert that a click on a settled graph does not make `isSimulating()` true and does not alter node coordinates. Drag tests will assert threshold, preserved grab offset, movement, and release behavior.

## 3. Statistics Terminology and Layout

The statistics modal keeps six cards but renames `全库事实` to `全库关系/属性`. The label means rows in the D1 `facts` table, including entity relations and scalar metadata such as ISBN and publication date. `当前关系` continues to mean links materialized in the current subgraph.

Every modal section explicitly sets `textAlign` and `textBaseline` before drawing. The node-type heading uses left alignment and the type chart is clipped to the modal's content rectangle. Card and chart coordinates derive from modal width and column count; tests cover desktop, narrow mobile, and representative 125%/150% logical viewport sizes.

## 4. Relationship Filter Layout

On desktop widths of at least 640 logical pixels, expanded filter pills begin immediately to the right of the `关系` toggle and wrap within the remaining scene width. They never occupy the left tool column below the toggle. Graph statistics, visibility, clear, and history controls retain that column.

Below 640 pixels, pills retain a compact grid beneath the toggle. Hit rectangles derive from the same layout calculation used for rendering, so visual and pointer geometry cannot diverge.

## 5. Casefile Data Boundaries

The existing eager details contract will be split into three bounded responses:

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
  items: RecommendationItem[];
}
```

The profile endpoint resolves referenced author, publisher, translator, award, series, and similar profile fields through a bounded batch query against `entities`. Scalar values remain scalar. Internal identifiers are not user-facing fallback text: unresolved references are omitted from profile fields and may be logged or counted for data-quality diagnostics.

Source prefixes are mapped to readable provenance names such as Wikidata, 豆瓣, 日本国会图书馆, 青空文库, Project Gutenberg, and OMM. The profile response does not expose the raw source ID as a displayed field.

Relations are ordered consistently, limited per response, and cursor-paginated when more rows exist. Recommendations remain ordered by stored rank and bounded to ten items. These endpoints are requested independently.

## 6. Casefile Tabs and Request State

The drawer has `档案`, `关系`, and `推荐` tabs and always opens on `档案`. Opening a node requests only its profile. Relations and recommendations use per-tab state:

```ts
type LazyTabState<T> =
  | { status: 'idle' }
  | { status: 'loading'; epoch: number }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };
```

The first activation starts its request and shows a centered spinner plus `正在加载关系…` or `正在加载推荐…`. Ready values are cached for the current drawer entity. Switching tabs does not refetch. An error state shows a concise message and a retry button. Opening another entity increments the drawer epoch; stale responses are ignored. Closing the drawer invalidates pending responses.

The `VERIFIED ARCHIVE` seal is removed. Header controls remain sticky. The content region scrolls as a single owner, and changing tabs resets that tab's scroll position.

## 7. Copy and Navigation Interaction

Every displayed profile field has one row hit target. A mouse click or mobile tap copies `copyValue`, never the label. For example, activating `ISBN：9787569930979` copies only `9787569930979`. The row briefly changes to an `已复制` state. Clipboard failure shows `复制失败` without closing the card.

The card's top copy button copies all currently available profile fields in readable form. It never triggers relations or recommendations and behaves the same regardless of the active tab.

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

All visible and interactive rectangles are generated by the same layout pass. The drawer continues to support dragging by its header on desktop, while taps on header buttons and fields do not begin card drag.

## 9. Error Handling

- Profile load failure keeps the casefile shell open and presents retry; it does not show stale data from the prior node.
- Lazy-tab failures affect only that tab.
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
- separate arrow navigation and 44-pixel touch target
- no eager relations/recommendations request

The final gate includes `oxfmt`, `oxlint`, all Bun tests, production build, Playwright interaction tests in headed Chrome and Firefox, mobile viewport/touch coverage, `git diff --check`, and production smoke checks after merge.
