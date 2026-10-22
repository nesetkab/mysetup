return {
  {
    "nvim-treesitter/nvim-treesitter",
    opts = { ensure_installed = { "systemverilog" } },
  },
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        verible = {},
      },
    },
  },
}
