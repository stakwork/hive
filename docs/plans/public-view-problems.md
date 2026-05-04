
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

### status

api/w/mikeoss/pool/status is returning 401 in public view. Is this a security hole if we expose that to public viewers?