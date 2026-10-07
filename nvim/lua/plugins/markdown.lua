return {
  {
    "MeanderingProgrammer/render-markdown.nvim",
    keys = {
      {
        "<leader>cv",
        ft = "markdown",
        function()
          require("mdpreview").toggle()
        end,
        desc = "Markdown Preview (Pane)",
      },
    },
  },
}
