# mysetup

My LazyVim, WezTerm and Claude Code config. Each folder is linked into place, so editing a file here changes the live setup.

## Layout and links

| In this repo | Linked from |
| --- | --- |
| `nvim/` | `~/.config/nvim` |
| `wezterm/.wezterm.lua` | `~/.wezterm.lua` |
| `claude/mods/desk/` | `~/.claude/mods/desk` |

To add a new config, move it in here and point the original path at it with `ln -s`. Never edit the linked path as if it were a separate copy.

## Look and feel

Everything follows Tokyo Night Moon on a transparent background with the JetBrainsMono Nerd Font.

- nvim: LazyVim with `folke/tokyonight.nvim`, `transparent = true`.
- WezTerm: `color_scheme = "Tokyo Night Moon"`, wallpaper in `wezterm/`, retro tab bar at the bottom.
- New UI should match: Tokyo Night colors, Nerd Font icons, no solid panels or gradients.

## Claude Code mod: `claude/mods/desk`

### Why it exists

Stock Claude Code is a long scrolling chat. Every file edit prints a full diff, every tool call gets its own row, and Claude's "let me check X" notes sit between the real answers. Finding what I asked earlier, or what actually changed, means scrolling through all of that.

The point of desk is to make Claude Code feel like the rest of my setup: one clear view of the current request, the work log and git state off to the side, earlier requests one keystroke away, and the same Tokyo Night look as nvim and WezTerm. Progress stays visible without the noise.

### What it does

Replaces the scrolling chat with an nvim-style layout:

- The latest request fills the screen: `you` and `claude` sections on the left, and an outline on the right with steps, files changed, and a git panel (uncommitted changes, commits not pushed, recent pushed commits).
- Earlier requests are folded to one line each. Click a fold or run `/fold N` to open it. `/fold` closes all and `/unfold` opens all.
- Left Option+Up and Option+Down move between chats.
- A lualine-style status bar sits above the prompt.
- Tool rows, diffs and Claude's in-between notes are hidden.

It is loaded through `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, which points at `~/.claude/mods/desk`. Mods need `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` on Claude Code builds before 2.1.287.

### Working on the mod

- All code is in `hooks/register.ts`. Do not write comments in it.
- Check it with `claude plugin validate claude/mods/desk` before committing.
- Changes load in a new `claude` session, or in the current one after `/reload-plugins`.
- To see this build's full mods API, load the `plugin-authoring` skill, which writes the type file, and grep it.
- Write Nerd Font icons and powerline separators as `\u` escapes (`''`), not pasted glyphs. Pasted glyphs from the private-use range get dropped when the file is written.
- Colors are the Tokyo Night Moon constants at the top of the file. Keep using them.
- `.claude-plugin/types/` is generated and gitignored.
- Verify visual changes with a screenshot. A test window can be opened with `wezterm cli spawn --new-window -- claude --model haiku` and driven with `wezterm cli send-text`.

## Git

- `nvim/bin/`, `nvim/lua/mdpreview.lua` and some nvim and WezTerm edits may be uncommitted work in progress. Only stage the files a change actually touched.
- Commit messages are short and imperative, like `Add split markdown preview keymap`.
