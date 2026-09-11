-- Pull in the wezterm API
local wezterm = require("wezterm")

-- This will hold the configuration.
local config = wezterm.config_builder()

-- This is where you actually apply your config choices

-- For example, changing the color scheme:

config.enable_tab_bar = false
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
    source = { File = "/Users/neset/Pictures/wezterm-banner.jpeg" },
    width = "Cover",
    height = "Cover",
    horizontal_align = "Center",
    vertical_align = "Middle",
    repeat_x = "NoRepeat",
    repeat_y = "NoRepeat",
    hsb = { brightness = 1.0, hue = 1.0, saturation = 1.0 },
  },
  -- Dark overlay on top of the image so text stays readable.
  {
    source = { Color = "#000000" },
    width = "100%",
    height = "100%",
    opacity = 0.65,
  },
}
-- and finally, return the configuration to wezterm
config.keys = {
  {key="Enter", mods="SHIFT", action=wezterm.action{SendString="\x1b\r"}},
}

return config
