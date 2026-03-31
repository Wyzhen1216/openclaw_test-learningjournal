# Skill Profile Switch

When you have multiple skills, use one command to switch workspace identity files.

## Commands

```bash
node skills/profile-switcher.js list
node skills/profile-switcher.js use <skill-name>
```

## How it works

- Looks for `skills/<skill>/workspace-profile/` first
- Falls back to `skills/<skill>/` if no `workspace-profile` exists
- Syncs these files to workspace root:
  - `AGENTS.md`
  - `SOUL.md`
  - `IDENTITY.md`
  - `TOOLS.md`

## Recommended structure

Keep profile files in:

`skills/<skill>/workspace-profile/`

This avoids cross-skill confusion and keeps personality/config coupled with each skill.
