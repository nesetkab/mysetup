return {
  {
    "folke/tokyonight.nvim",
    lazy = false, -- or true, depending on your loading strategy
    priority = 1000, -- ensure it loads first
    opts = {
      transparent = true, -- This is the key option
      styles = {
        -- You can also make specific parts transparent
        sidebars = "transparent",
        floats = "transparent",
      },
    },
  },
}
