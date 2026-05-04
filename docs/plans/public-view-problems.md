
# public view issues

### repo learnings ✅ DONE

Process Repository section should not show at all if the user has no access (the toggle fails anyway)

### github app ✅ DONE

Github App Not Installed shows on the main dashboard page

### calls page ✅ DONE

Maybe calls page should be hidden totally? and hidden from sidebar? no point in public view mode

### hide the Link Github button ✅ DONE

Link Github button on the main dashboard should be hidden

### workspace switcher ✅ DONE

the workspace switcher on the top left is totally hidden! although the workspace switcher should be not clickable, its still nice of just a label of what you are on. So put it back but just make it non-interactive

### the docs and Concepts should load ✅ DONE

when i sign in, i can see a few docs and Concepts on the /learn page. But signed out in public view those are empty! You should be able to view them! (but not edit them or add more of course). Please do a deep dive here to make sure its architected correctly

### status ✅ DONE

api/w/[slug]/pool/status is returning 401 in public view. Is this a security hole if we expose that to public viewers? If not, lets make that publically accessible too

**Resolution:** Made public. The endpoint returns aggregate pod counters only
(`runningVms`, `pendingVms`, `failedVms`, `usedVms`, `unusedVms`, `queuedCount`,
`lastCheck`) — no pod URLs, IDs, hostnames, credentials, or env config — so
exposure is well below the existing public-disclosure bar (members, full
features/tasks, graph nodes are already public). Followed the standard
public-route convention: added `/api/w/*/pool/status` (GET only) to
`ROUTE_POLICIES` in `src/config/middleware.ts` and swapped the handler from
`requireAuth` to `resolveWorkspaceAccess` + `requireReadAccess`. Updated
integration tests in `src/__tests__/integration/api/pool-status.test.ts` to
match (drops the `requireAuth` mock in favor of the real header-driven flow,
adds an explicit anonymous-on-public-workspace test).