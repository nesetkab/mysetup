-- Pull in the wezterm API
local wezterm = require("wezterm")

-- This will hold the configuration.
local config = wezterm.config_builder()

-- This is where you actually apply your config choices

-- For example, changing the color scheme:

config.front_end = "WebGpu"
config.color_scheme = "Tokyo Night Moon"

config.enable_tab_bar = true
config.tab_bar_at_bottom = true
config.use_fancy_tab_bar = false
config.show_new_tab_button_in_tab_bar = false
config.tab_max_width = 32
config.colors = {
  tab_bar = {
    background = "#0b0b10",
    active_tab = { bg_color = "#1a1b26", fg_color = "#7aa2f7", intensity = "Bold" },
    inactive_tab = { bg_color = "#0b0b10", fg_color = "#565f89" },
    inactive_tab_hover = { bg_color = "#16161e", fg_color = "#a9b1d6" },
  },
}
local tab_icons = {
  claude = { glyph = "\u{100000}\u{100001}", color = "#d77757" },
  nvim = { glyph = "\u{f04b2}", color = "#c3e88d" },
}

wezterm.on("format-tab-title", function(tab, _, _, _, hover)
  local path = (tab.active_pane.current_working_dir and tab.active_pane.current_working_dir.file_path or ""):gsub("/$", "")
  local name = path == wezterm.home_dir and "\u{f02dc}" or (path:match("[^/]+$") or path)
  local process = (tab.active_pane.foreground_process_name or ""):match("[^/]+$")
  local icon = tab_icons[process]
  local state = tab.is_active and "active_tab" or hover and "inactive_tab_hover" or "inactive_tab"
  local colors = config.colors.tab_bar[state]
  local items = { { Background = { Color = colors.bg_color } }, { Text = " " } }
  if icon then
    table.insert(items, { Foreground = { Color = icon.color } })
    table.insert(items, { Text = icon.glyph .. " " })
  end
  table.insert(items, { Foreground = { Color = colors.fg_color } })
  table.insert(items, { Text = name .. " " })
  return items
end)
config.font_dirs = { wezterm.home_dir .. "/wowcode/mysetup/wezterm/fonts" }
config.font = wezterm.font_with_fallback({ "JetBrainsMono Nerd Font", "Clawd" })
-- Opaque window: the desktop behind WezTerm does not show through.
config.window_background_opacity = 1.0

config.background = {
  -- Base color, visible wherever the image does not reach.
  {
    source = { Color = "#0b0b10" },
    width = "100%",
    height = "100%",
  },
  -- The image, scaled to cover the window without distortion.
  {
    source = { File = "/Users/neset/Pictures/wezterm-banner-dim.jpeg" },
    width = "Cover",
    height = "Cover",
    horizontal_align = "Center",
    vertical_align = "Middle",
    repeat_x = "NoRepeat",
    repeat_y = "NoRepeat",
    hsb = { brightness = 1.0, hue = 1.0, saturation = 1.0 },
  },
}
-- and finally, return the configuration to wezterm
config.keys = {
  {key="Enter", mods="SHIFT", action=wezterm.action{SendString="\x1b\r"}},
}

return config
