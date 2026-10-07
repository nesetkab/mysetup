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
config.font = wezterm.font("JetBrainsMono Nerd Font")
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
