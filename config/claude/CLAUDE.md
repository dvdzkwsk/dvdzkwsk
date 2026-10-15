# Global Claude Instructions

## Setup scripts are the source of truth

When asked to update a setup/install/configuration script, make the change to the script and then re-run the script to apply it. Do not separately run the equivalent command outside the script. The script is the canonical way to apply that change, and running it directly bypasses that contract.

## Writing style

Use the Oxford comma in all writing: replies, docs, code comments, commit messages, and UI copy. In a list of three or more, put a comma before the final "and" or "or" ("rinks, teams, and players", not "rinks, teams and players").
