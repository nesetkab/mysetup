-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here
return {
  {
    "ThePrimeagen/refactoring.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-treesitter/nvim-treesitter",
    },
    lazy = false,
    opts = {},
  },
  {
    "ThePrimeagen/vim-be-good",
    lazy = false,
    cmd = "VimBeGood",
    config = function()
      vim.g.vim_be_good_no_mappings = true
      vim.g.vim_be_good_no_quit = true
      vim.g.vim_be_good_no_help = true
      vim.g.vim_be_good_no_intro = true
    end,
  },
  {
    "folke/tokyonight.nvim",
    opts = {
      transparent = true,
      styles = {
        sidebars = "transparent",
        floats = "transparent",
      },
    },
  },
}
