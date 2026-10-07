local M = {}

local script = vim.fn.stdpath("config") .. "/bin/mdpreview.mjs"
local session = nil

local function wezterm(args)
  local result = vim.system(vim.list_extend({ "wezterm", "cli" }, args), { text = true }):wait()
  if result.code ~= 0 then
    return nil
  end
  return vim.trim(result.stdout)
end

local function publish()
  local buf = vim.api.nvim_get_current_buf()
  if not session or vim.bo[buf].filetype ~= "markdown" then
    return
  end
  local data = vim.json.encode({
    file = vim.api.nvim_buf_get_name(buf),
    cursor = vim.api.nvim_win_get_cursor(0)[1],
    text = table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n"),
  })
  local staging = session.state .. ".next"
  local file = io.open(staging, "w")
  if not file then
    return
  end
  file:write(data)
  file:close()
  vim.uv.fs_rename(staging, session.state)
end

function M.close()
  if not session then
    return
  end
  wezterm({ "kill-pane", "--pane-id", session.pane })
  session.timer:close()
  vim.api.nvim_del_augroup_by_id(session.group)
  vim.fn.delete(session.dir, "rf")
  session = nil
end

function M.open()
  local host = vim.env.WEZTERM_PANE
  if not host then
    vim.notify("Markdown preview needs WezTerm", vim.log.levels.WARN)
    return
  end
  local dir = vim.fn.tempname()
  vim.fn.mkdir(dir, "p")
  session = { dir = dir, state = dir .. "/state.json", timer = vim.uv.new_timer() }
  publish()
  local pane = wezterm({
    "split-pane",
    "--right",
    "--percent",
    "45",
    "--pane-id",
    host,
    "--",
    vim.fn.exepath("node"),
    script,
    session.state,
    vim.fn.exepath("python3"),
  })
  if not pane then
    vim.notify("Could not open the preview pane", vim.log.levels.ERROR)
    session.timer:close()
    vim.fn.delete(dir, "rf")
    session = nil
    return
  end
  session.pane = pane
  wezterm({ "activate-pane", "--pane-id", host })
  session.group = vim.api.nvim_create_augroup("mdpreview", { clear = true })
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "CursorMoved", "CursorMovedI", "BufEnter" }, {
    group = session.group,
    callback = function()
      session.timer:stop()
      session.timer:start(30, 0, vim.schedule_wrap(publish))
    end,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", { group = session.group, callback = M.close })
end

function M.toggle()
  if session then
    M.close()
  else
    M.open()
  end
end

return M
