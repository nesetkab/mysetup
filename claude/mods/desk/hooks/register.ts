import type { Register } from 'claude-code'

type Change = { added: number; removed: number }

type Step = {
  kind: string
  label: string
  pending: number
  count: number
  isFailed: boolean
  change?: Change
}

type Task = {
  id: number
  prompt: string
  title: string
  startedAt: number
  durationMs: number
  steps: Step[]
  files: Map<string, Change>
  turnIds: Set<string>
  narration: Set<string>
  answers: string[]
  followUps: string[]
  isDone: boolean
  isAborted: boolean
  isOpen: boolean
}

type ToolInput = Record<string, any> & { tool: string; agentId?: string }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SKIPPED_STEPS = new Set(['TodoWrite', 'ToolSearch', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'AskUserQuestion'])
const KEPT_ROWS = new Set(['ExitPlanMode', 'EnterPlanMode'])
const NO_CHANGE: Change = { added: 0, removed: 0 }
const MAX_STEPS = 14
const MAX_NOTES = 8
const RESERVED_ROWS = 16
const ICON_USER = '\uf007'
const ICON_STEPS = '\uf0ca'
const ICON_FILES = '\uf07c'
const ICON_FILE = '\uf15b'
const ICON_DONE = '\uf00c'
const ICON_FAILED = '\uf00d'
const ICON_RUNNING = '\uf110'
const ICON_CLOCK = '\uf017'
const SEP_RIGHT = '\ue0b0'
const SEP_LEFT = '\ue0b2'
const ICON_BRANCH = '\ue0a0'
const ICON_CHANGED = '\uf044'
const ICON_UNPUSHED = '\uf062'
const ICON_PUSHED = '\uf0ee'
const ICON_FOLDED = '\uf460'
const ICON_UNFOLDED = '\uf47c'
const FOLD_BG = '#2f334d'
const VIEWED_BG = '#3e68d7'
const ICON_VIEWED = '\uf061'
const ICON_FOLLOW = '\u21b3'
const ICON_CLAUDE = '\u{100000}\u{100001}'
const FG = '#c8d3f5'
const FG_DARK = '#828bb8'
const COMMENT = '#636da6'
const GUTTER = '#3b4261'
const BG_DARK = '#1e2030'
const BLUE = '#82aaff'
const MAGENTA = '#c099ff'
const GREEN = '#c3e88d'
const YELLOW = '#ffc777'
const RED = '#ff757f'
const CLAWD = '#d77757'
const MARKDOWN_LIMIT = 9500

let tasks: Task[] = []
let nextId = 1
let viewIndex: number | null = null

const boundRows = new Map<string, Task>()

function splitLines(text: string | undefined) {
  if (!text) return []
  return text.replace(/\n$/, '').split('\n')
}

function countChange(before: string | undefined, after: string | undefined): Change {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return { added: endB - start, removed: endA - start }
}

function addChanges(x: Change, y: Change): Change {
  return { added: x.added + y.added, removed: x.removed + y.removed }
}

function clip(text: string, max: number) {
  return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text
}

function shownPrompt(text: string) {
  const collapsed = text.replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, (_, body: string) => `[pasted ${plural(splitLines(body.trim()).length, 'line')}]`)
  return clip(collapsed, 2000)
}

function firstLine(text: string, max: number) {
  return clip((text ?? '').trim().split('\n')[0], max)
}

function basename(path: string) {
  return (path ?? '').split('/').pop() ?? path
}

function hostOf(url: string) {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(url ?? '')
  return match ? match[1] : url
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatChange(change: Change) {
  return `+${change.added} −${change.removed}`
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function describe(input: ToolInput) {
  switch (input.tool) {
    case 'Read':
      return 'Read ' + basename(input.file_path)
    case 'Edit':
    case 'MultiEdit':
      return 'Edited ' + basename(input.file_path)
    case 'Write':
      return 'Wrote ' + basename(input.file_path)
    case 'NotebookEdit':
      return 'Edited ' + basename(input.notebook_path)
    case 'Bash':
      return input.description ? firstLine(input.description, 60) : 'Ran ' + firstLine(input.command ?? '', 50)
    case 'Grep':
      return `Searched for "${firstLine(input.pattern ?? '', 40)}"`
    case 'Glob':
      return 'Looked for ' + firstLine(input.pattern ?? '', 40)
    case 'WebFetch':
      return 'Opened ' + hostOf(input.url)
    case 'WebSearch':
      return `Searched the web for "${firstLine(input.query ?? '', 40)}"`
    case 'Agent':
    case 'Task':
      return 'Agent: ' + firstLine(input.description ?? 'working', 50)
    case 'Skill':
      return 'Used ' + input.skill
    default:
      return input.tool.split('__').pop()!.replace(/_/g, ' ')
  }
}

function changeFromInput(input: ToolInput, before: string): Change {
  if (input.tool === 'Edit') return countChange(input.old_string, input.new_string)
  if (input.tool === 'MultiEdit') {
    return (input.edits ?? [])
      .map((edit: any) => countChange(edit.old_string, edit.new_string))
      .reduce(addChanges, NO_CHANGE)
  }
  if (input.tool === 'Write') return countChange(before, input.content)
  return countChange('', input.new_source)
}

async function measure($: any, input: ToolInput) {
  let before = ''
  if (input.tool === 'Write') {
    try {
      before = await $.fs.read(input.file_path)
    } catch {}
  }
  return changeFromInput(input, before)
}

function createTask(prompt: string, startedAt: number): Task {
  return {
    id: nextId++,
    prompt: prompt.trim(),
    title: firstLine(prompt, 60),
    startedAt,
    durationMs: 0,
    steps: [],
    files: new Map(),
    turnIds: new Set(),
    narration: new Set(),
    answers: [],
    followUps: [],
    isDone: false,
    isAborted: false,
    isOpen: false,
  }
}

function addStep(task: Task, input: ToolInput): Step {
  const last = task.steps[task.steps.length - 1]
  if (input.tool === 'Read' && last?.kind === 'Read' && !last.isFailed) {
    last.count += 1
    last.pending += 1
    last.label = `Read ${last.count} files`
    return last
  }
  const step: Step = { kind: input.tool, label: describe(input), pending: 1, count: 1, isFailed: false }
  task.steps.push(step)
  return step
}

function recordChange(task: Task, step: Step, input: ToolInput, change: Change) {
  const path = input.file_path ?? input.notebook_path
  step.change = addChanges(step.change ?? NO_CHANGE, change)
  task.files.set(path, addChanges(task.files.get(path) ?? NO_CHANGE, change))
}

function totalChange(task: Task) {
  return [...task.files.values()].reduce(addChanges, NO_CHANGE)
}

function stepCount(task: Task) {
  return task.steps.reduce((sum, step) => sum + step.count, 0)
}

function answerText(task: Task) {
  return task.answers.join('\n\n')
}

function fitsPage(task: Task) {
  return answerText(task).length <= MARKDOWN_LIMIT
}

function rebuild(messages: any[]) {
  tasks = []
  boundRows.clear()
  let current: Task | null = null
  let texts: { text: string; index: number }[] = []
  let lastToolIndex = -1
  const finish = () => {
    if (!current) return
    for (const { text, index } of texts) {
      if (index <= lastToolIndex) current.narration.add(text)
      else current.answers.push(text)
    }
  }
  messages.forEach((message, index) => {
    const text = (message.text ?? '').trim()
    if (message.role === 'user') {
      if (!text || text.startsWith('<')) return
      if (message.toolResults?.length) {
        current?.followUps.push(text)
        return
      }
      finish()
      current = createTask(text, 0)
      current.isDone = true
      tasks.push(current)
      texts = []
      lastToolIndex = -1
      return
    }
    if (!current) return
    for (const use of message.toolUses ?? []) {
      lastToolIndex = index
      if (SKIPPED_STEPS.has(use.tool)) continue
      const input = { ...use.input, tool: use.tool } as ToolInput
      const step = addStep(current, input)
      step.pending = 0
      if (use.isError) step.isFailed = true
      else if (EDIT_TOOLS.has(use.tool)) recordChange(current, step, input, changeFromInput(input, ''))
    }
    if (text) texts.push({ text, index })
  })
  finish()
}

function runningTask() {
  const last = tasks[tasks.length - 1]
  return last && !last.isDone ? last : null
}

function latestTask() {
  return tasks[tasks.length - 1] ?? null
}

function viewedTask() {
  return (viewIndex !== null && tasks[viewIndex]) || latestTask()
}

function moveView($: any, direction: number) {
  if (tasks.length === 0) return
  const current = viewIndex ?? tasks.length - 1
  const target = Math.max(0, Math.min(tasks.length - 1, current + direction))
  viewIndex = target === tasks.length - 1 ? null : target
  redraw($)
}

function holds(entries: Iterable<string>, text: string) {
  for (const entry of entries) {
    if (entry === text) return true
    if (text.length >= 24 && entry.includes(text)) return true
  }
  return false
}

function ownerOfReply(text: string) {
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = tasks[i]
    if (holds(task.narration, text)) return { task, isNarration: true }
    if (holds(task.answers, text)) return { task, isNarration: false }
  }
  return null
}

function ownerOfPrompt(rowId: string, text: string) {
  const bound = boundRows.get(rowId)
  if (bound) return bound
  const taken = new Set(boundRows.values())
  const newestFirst = [...tasks].reverse()
  const match =
    newestFirst.find((task) => task.prompt === text && !taken.has(task)) ??
    newestFirst.find((task) => task.prompt === text)
  if (match) boundRows.set(rowId, match)
  return match ?? null
}

function ownerOfFollowUp(text: string) {
  return [...tasks].reverse().find((task) => task.followUps.includes(text)) ?? null
}

function statusWord(task: Task, now: number) {
  if (!task.isDone) return 'working · ' + formatDuration(now - task.startedAt)
  if (task.isAborted) return 'stopped'
  return 'done' + (task.durationMs ? ' · ' + formatDuration(task.durationMs) : '')
}

function workSummary(task: Task) {
  const parts: string[] = []
  const steps = stepCount(task)
  if (steps > 0) parts.push(plural(steps, 'step'))
  if (task.files.size > 0) parts.push(`${plural(task.files.size, 'file')} ${formatChange(totalChange(task))}`)
  return parts.join(' · ')
}

function redraw($: any) {
  $.ui.invalidate('ui.render')
}

function hide($: any, e: any) {
  const { Box } = $.ui.resolve(e)
  return Box({ children: [] })
}

function toggle($: any, task: Task) {
  task.isOpen = !task.isOpen
  redraw($)
}

async function loadHistory($: any) {
  try {
    rebuild(await $.session.messages())
  } catch {
    tasks = []
  }
  redraw($)
}

function rule(elements: any, key: string, icon: string, text: string, color: string, width: number, extra = '', iconColor = color) {
  const { Box, Text } = elements
  const head = `${icon} ${text}`
  const tail = extra ? ` ${extra} ` : ' '
  return Box({
    key,
    flexDirection: 'row',
    children: [
      Text({ color: iconColor, children: [icon + ' '] }),
      Text({ bold: true, color, children: [text] }),
      Text({ color: COMMENT, children: [tail] }),
      Text({ color: GUTTER, children: ['─'.repeat(Math.max(0, width - [...head].length - tail.length))] }),
    ],
  })
}

function outline(elements: any, task: Task, width: number) {
  const { Box, Text } = elements
  const steps = task.steps.slice(-MAX_STEPS)
  const earlier = task.steps.length - steps.length
  const stepRows = steps.map((step, index) => {
    const isRunning = step.pending > 0
    const mark = isRunning ? ICON_RUNNING : step.isFailed ? ICON_FAILED : ICON_DONE
    const color = isRunning ? YELLOW : step.isFailed ? RED : GREEN
    return Box({
      key: `step-${earlier + index}`,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color, children: [mark] }),
        Text({ color: isRunning ? FG : FG_DARK, children: [clip(step.label, width - 4)] }),
      ],
    })
  })
  const fileRows = [...task.files.entries()].map(([path, change]) =>
    Box({
      key: 'file-' + path,
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Text({ color: FG_DARK, children: [ICON_FILE + ' ' + clip(basename(path), width - 14)] }),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [Text({ color: GREEN, children: ['+' + change.added] }), Text({ color: RED, children: ['-' + change.removed] })],
        }),
      ],
    }),
  )
  return [
    rule(elements, 'steps-title', ICON_STEPS, 'steps', BLUE, width, String(stepCount(task))),
    ...(earlier > 0 ? [Text({ key: 'earlier', color: COMMENT, children: [`  ${earlier} more above`] })] : []),
    ...(stepRows.length > 0 ? stepRows : [Text({ key: 'no-steps', color: COMMENT, children: [task.isDone ? '  none' : '  thinking'] })]),
    Text({ key: 'gap-files', children: [' '] }),
    rule(elements, 'files-title', ICON_FILES, 'files', BLUE, width, String(task.files.size)),
    ...(fileRows.length > 0 ? fileRows : [Text({ key: 'no-files', color: COMMENT, children: ['  none'] })]),
  ]
}

function roughRows(text: string, width: number) {
  return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / Math.max(20, width))), 0)
}

function foldMeta(task: Task) {
  const parts = [workSummary(task)]
  if (task.durationMs) parts.push(formatDuration(task.durationMs))
  return parts.filter(Boolean).join(' · ')
}

function foldLine($: any, elements: any, task: Task, columns: number) {
  const { Box, Text, Button } = elements
  const number = tasks.indexOf(task) + 1
  const isViewed = task === viewedTask() && task !== latestTask()
  const icon = isViewed ? ICON_VIEWED : task.isOpen ? ICON_UNFOLDED : ICON_FOLDED
  const meta = ` ${foldMeta(task)} `
  const room = Math.max(10, columns - meta.length - 10)
  const label = `${icon} ${number}  ${clip(firstLine(shownPrompt(task.prompt), 400), room)} `
  const dots = Math.max(1, columns - label.length - meta.length - 6)
  return Box({
    key: 'fold-' + task.id,
    flexDirection: 'row',
    width: columns,
    backgroundColor: isViewed ? VIEWED_BG : FOLD_BG,
    children: [
      Button({ key: 'toggle-' + task.id, label, plain: true, onPress: () => toggle($, task) }),
      Text({ color: GUTTER, children: ['·'.repeat(dots)] }),
      Text({ color: COMMENT, children: [meta] }),
    ],
  })
}

function notes(elements: any, task: Task, width: number) {
  const { Box, Text } = elements
  const all = [...task.narration]
  const shown = all.slice(-MAX_NOTES)
  const earlier = all.length - shown.length
  return [
    ...(earlier > 0 ? [Text({ key: 'notes-earlier', color: COMMENT, children: [`${earlier} earlier`] })] : []),
    ...shown.map((note, index) =>
      Box({
        key: `note-${earlier + index}`,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ color: GUTTER, children: ['│'] }),
          Text({ color: COMMENT, italic: true, children: [clip(note.replace(/\*\*|__|`/g, ''), width * 3)] }),
        ],
      }),
    ),
  ]
}

function conversation(elements: any, task: Task, width: number, now: number, withSteps: boolean) {
  const { Box, Text, Markdown } = elements
  const answer = answerText(task)
  const noteRows = notes(elements, task, width - 2)
  const status = !task.isDone
    ? 'working ' + formatDuration(now - task.startedAt)
    : task.isAborted
      ? 'stopped'
      : 'done' + (task.durationMs ? ' in ' + formatDuration(task.durationMs) : '')
  const reply = !task.isDone
    ? [
        ...(noteRows.length > 0 ? noteRows : [Text({ key: 'working', color: COMMENT, italic: true, children: ['thinking…'] })]),
        ...(withSteps ? outline(elements, task, width) : []),
      ]
    : [
        ...noteRows,
        ...(noteRows.length > 0 && answer ? [Text({ key: 'gap-answer', children: [' '] })] : []),
        ...(!answer
          ? []
          : fitsPage(task)
            ? [Markdown({ key: 'answer', text: answer })]
            : [Text({ key: 'answer-below', color: COMMENT, children: ['long answer, shown below'] })]),
      ]
  return [
    rule(elements, 'you', ICON_USER, 'you', MAGENTA, width),
    Text({ key: 'prompt', color: FG, children: [shownPrompt(task.prompt)] }),
    ...task.followUps.map((text, index) =>
      Box({
        key: `follow-${index}`,
        flexDirection: 'row',
        columnGap: 1,
        children: [Text({ color: MAGENTA, children: [ICON_FOLLOW] }), Text({ color: FG, children: [shownPrompt(text)] })],
      }),
    ),
    Text({ key: 'gap', children: [' '] }),
    rule(elements, 'claude', ICON_CLAUDE, 'claude', task.isDone ? (task.isAborted ? RED : BLUE) : YELLOW, width, status, CLAWD),
    ...reply,
  ]
}

function openedFold($: any, e: any, task: Task, now: number) {
  const elements = $.ui.resolve(e)
  const { Box } = elements
  const columns = (e.viewport?.columns ?? 100) - 2
  return Box({
    flexDirection: 'column',
    children: [
      foldLine($, elements, task, columns),
      Box({ key: 'body', flexDirection: 'column', paddingLeft: 2, marginBottom: 1, children: conversation(elements, task, columns - 2, now, true) }),
    ],
  })
}

function folded($: any, e: any, task: Task) {
  const elements = $.ui.resolve(e)
  return foldLine($, elements, task, (e.viewport?.columns ?? 100) - 2)
}

function page($: any, e: any, task: Task, now: number) {
  const elements = $.ui.resolve(e)
  const { Box, Text } = elements
  const columns = (e.viewport?.columns ?? 100) - 2
  const rows = e.viewport?.rows ?? 40
  const hasSide = columns >= 110
  const sideWidth = hasSide ? Math.min(48, Math.floor(columns * 0.3)) : 0
  const mainWidth = hasSide ? columns - sideWidth - 3 : columns
  const minHeight = Math.max(8, rows - RESERVED_ROWS)
  const main = Box({ key: 'main', flexDirection: 'column', width: mainWidth, children: conversation(elements, task, mainWidth, now, !hasSide) })

  if (!hasSide) {
    return Box({
      flexDirection: 'column',
      marginTop: 1,
      minHeight,
      children: [main, ...(task.isDone ? outline(elements, task, mainWidth) : []), ...gitPanel(elements, mainWidth)],
    })
  }

  const side = [...outline(elements, task, sideWidth), ...gitPanel(elements, sideWidth)]
  const height = Math.max(minHeight, side.length + 2, roughRows([task.prompt, ...task.followUps].map(shownPrompt).join('\n'), mainWidth) + roughRows([...task.narration, fitsPage(task) ? answerText(task) : ''].join('\n'), mainWidth - 2) + 6)
  return Box({
    flexDirection: 'row',
    marginTop: 1,
    minHeight,
    columnGap: 1,
    children: [
      main,
      Text({ key: 'split', color: GUTTER, children: [Array(height).fill('│').join('\n')] }),
      Box({ key: 'side', flexDirection: 'column', width: sideWidth, children: side }),
    ],
  })
}

function segment(elements: any, key: string, text: string, color: string, background?: string, bold = false) {
  const { Text } = elements
  return Text({ key, color, bold, ...(background ? { backgroundColor: background } : {}), children: [text] })
}

function statusline($: any, e: any, task: Task, now: number) {
  const elements = $.ui.resolve(e)
  const { Box, Button } = elements
  const mode = !task.isDone ? YELLOW : task.isAborted ? RED : GREEN
  const word = !task.isDone ? 'WORKING' : task.isAborted ? 'STOPPED' : 'DONE'
  const time = !task.isDone ? formatDuration(now - task.startedAt) : task.durationMs ? formatDuration(task.durationMs) : '—'
  const current = !task.isDone && task.steps.length > 0 ? task.steps[task.steps.length - 1].label : ''
  const change = task.files.size > 0 ? ` ${formatChange(totalChange(task))}` : ''
  return Box({
    key: 'statusline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: e.props.bodyColumns,
    paddingRight: 4,
    children: [
      Box({
        key: 'left',
        flexDirection: 'row',
        children: [
          segment(elements, 'mode', ` ${ICON_CLAUDE} ${word} `, BG_DARK, mode, true),
          segment(elements, 'mode-sep', SEP_RIGHT, mode, GUTTER),
          segment(elements, 'steps', ` ${ICON_STEPS} ${stepCount(task)} `, BLUE, GUTTER),
          segment(elements, 'steps-sep', SEP_RIGHT, GUTTER),
          segment(elements, 'files', ` ${ICON_FILES} ${task.files.size}${change} `, FG_DARK),
          ...(git ? [segment(elements, 'git-sep', SEP_RIGHT, GUTTER), segment(elements, 'git', gitSegment(), MAGENTA, GUTTER), segment(elements, 'git-end', SEP_RIGHT, GUTTER)] : []),
          ...(current ? [segment(elements, 'current', ` ${clip(current, 50)}`, COMMENT)] : []),
        ],
      }),
      Box({
        key: 'right',
        flexDirection: 'row',
        children: [
          segment(elements, 'time', `${ICON_CLOCK} ${time} `, FG_DARK),
          segment(elements, 'task-sep', SEP_LEFT, GUTTER),
          segment(elements, 'task', ` ${tasks.indexOf(task) + 1}/${tasks.length} `, BLUE, GUTTER),
          segment(elements, 'end-sep', SEP_LEFT, mode, GUTTER),
          segment(elements, 'end', ` ${shortTime(now)} `, BG_DARK, mode, true),
          Button({ key: 'prev', label: ' ⌥↑', plain: true, dimColor: true, action: 'app:diffFileListUp', onPress: () => moveView($, -1) }),
          Button({ key: 'next', label: ' ⌥↓', plain: true, dimColor: true, action: 'app:diffFileListDown', onPress: () => moveView($, 1) }),
        ],
      }),
    ],
  })
}

function shortTime(now: number) {
  const date = new Date(now)
  const hours = date.getHours() % 12 || 12
  return `${hours}:${String(date.getMinutes()).padStart(2, '0')}`
}

type Commit = { hash: string; subject: string }

type GitChange = { path: string; status: string; added: number; removed: number; isNew: boolean }

type GitState = {
  branch: string
  upstream: string
  changes: GitChange[]
  unpushed: Commit[]
  pushed: Commit[]
}

let git: GitState | null = null
let isGitBusy = false

function parseLog(text: string): Commit[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ')
      return { hash: line.slice(0, space), subject: line.slice(space + 1) }
    })
}

function parseChanges(status: string, numstat: string): GitChange[] {
  const counts = new Map<string, Change>()
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added, removed, path] = line.split('\t')
    counts.set(path, { added: Number(added) || 0, removed: Number(removed) || 0 })
  }
  return status
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2)
      const path = line.slice(3).split(' -> ').pop() ?? ''
      const isNew = code === '??'
      const change = counts.get(path) ?? NO_CHANGE
      return { path, status: isNew ? '?' : code.trim()[0] ?? 'M', added: change.added, removed: change.removed, isNew }
    })
}

async function refreshGit($: any) {
  if (isGitBusy) return
  isGitBusy = true
  try {
    const run = async (args: string[]) => {
      const result = await $.process.run(['git', ...args], { timeoutMs: 5000 })
      return result.exitCode === 0 ? String(result.stdout) : null
    }
    const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD'])
    if (branch === null) {
      git = null
      return
    }
    const upstream = ((await run(['rev-parse', '--abbrev-ref', '@{u}'])) ?? '').trim()
    const status = (await run(['status', '--porcelain'])) ?? ''
    const numstat = (await run(['diff', '--numstat', 'HEAD'])) ?? (await run(['diff', '--numstat'])) ?? ''
    const unpushed = upstream
      ? parseLog((await run(['log', '--format=%h %s', '-n', '6', '@{u}..HEAD'])) ?? '')
      : parseLog((await run(['log', '--format=%h %s', '-n', '4'])) ?? '')
    const pushed = upstream ? parseLog((await run(['log', '--format=%h %s', '-n', '3', '@{u}'])) ?? '') : []
    git = { branch: branch.trim(), upstream, changes: parseChanges(status, numstat), unpushed, pushed }
  } catch {
    git = null
  } finally {
    isGitBusy = false
    redraw($)
  }
}

function gitPanel(elements: any, width: number) {
  const { Box, Text } = elements
  if (!git) return []
  const state = git
  const commitRow = (commit: Commit, color: string, key: string) =>
    Box({
      key,
      flexDirection: 'row',
      columnGap: 1,
      children: [Text({ color, children: [commit.hash] }), Text({ color: FG_DARK, children: [clip(commit.subject, width - commit.hash.length - 2)] })],
    })
  const changeRows = state.changes.slice(0, 10).map((change) =>
    Box({
      key: 'change-' + change.path,
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Text({ color: change.isNew ? GREEN : change.status === 'D' ? RED : YELLOW, children: [change.status] }),
            Text({ color: FG_DARK, children: [clip(change.path, width - 14)] }),
          ],
        }),
        change.isNew
          ? Text({ color: GREEN, children: ['new'] })
          : Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [Text({ color: GREEN, children: ['+' + change.added] }), Text({ color: RED, children: ['-' + change.removed] })],
            }),
      ],
    }),
  )
  const hiddenChanges = state.changes.length - changeRows.length
  return [
    Text({ key: 'gap-git', children: [' '] }),
    rule(elements, 'git-title', ICON_BRANCH, state.branch, BLUE, width, state.upstream ? '→ ' + state.upstream : 'no upstream'),
    Text({ key: 'changes-title', bold: true, color: YELLOW, children: [`${ICON_CHANGED} changed ${state.changes.length}`] }),
    ...(changeRows.length > 0 ? changeRows : [Text({ key: 'clean', color: COMMENT, children: ['  clean'] })]),
    ...(hiddenChanges > 0 ? [Text({ key: 'more-changes', color: COMMENT, children: [`  ${hiddenChanges} more`] })] : []),
    Text({
      key: 'unpushed-title',
      bold: true,
      color: MAGENTA,
      children: [`${ICON_UNPUSHED} ${state.upstream ? 'committed, not pushed' : 'local commits'} ${state.unpushed.length}`],
    }),
    ...(state.unpushed.length > 0
      ? state.unpushed.map((commit) => commitRow(commit, MAGENTA, 'unpushed-' + commit.hash))
      : [Text({ key: 'none-unpushed', color: COMMENT, children: ['  up to date'] })]),
    ...(state.upstream
      ? [
          Text({ key: 'pushed-title', bold: true, color: GREEN, children: [`${ICON_PUSHED} pushed`] }),
          ...state.pushed.map((commit) => commitRow(commit, GREEN, 'pushed-' + commit.hash)),
        ]
      : []),
  ]
}

function gitSegment() {
  if (!git) return ''
  const ahead = git.upstream ? ` ↑${git.unpushed.length}` : ''
  const dirty = git.changes.length > 0 ? ` ●${git.changes.length}` : ''
  return ` ${ICON_BRANCH} ${git.branch}${ahead}${dirty} `
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'unfold', description: 'Open every earlier chat' })
    await $.command.register({ name: 'fold', description: 'Fold every earlier chat, or toggle one: /fold 3' })
    if (tasks.length === 0) await loadHistory($)
    void refreshGit($)
    let seconds = 0
    $.clock.every(1000, () => {
      seconds += 1
      if (runningTask()) redraw($)
      if (seconds % 15 === 0) void refreshGit($)
    })
    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadHistory($)
    return next(e)
  })

  on('command.run', { command: 'unfold' }, async ($) => {
    for (const task of tasks) task.isOpen = true
    redraw($)
    return {}
  })

  on('command.run', { command: 'fold' }, async ($, e) => {
    const task = tasks[Number(String(e.args ?? '').trim()) - 1]
    if (task) task.isOpen = !task.isOpen
    else for (const one of tasks) one.isOpen = false
    redraw($)
    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    const task = e.turnId ? tasks.find((one) => one.turnIds.has(e.turnId!)) : null
    const text = e.text.trim()
    if (task && e.origin.kind === 'composer' && text) {
      task.followUps.push(text)
      redraw($)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.text) {
      for (const one of tasks) one.followUps = one.followUps.filter((text) => text !== e.text.trim())
      const task = createTask(e.text, await $.clock.now())
      task.turnIds.add(e.turnId)
      tasks.push(task)
      viewIndex = null
    } else {
      const last = tasks[tasks.length - 1]
      if (last) {
        last.isDone = false
        last.turnIds.add(e.turnId)
      }
    }
    redraw($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const task = tasks.find((one) => one.turnIds.has(e.turnId))
    let streamed = ''
    let block = -1
    let live = ''
    for await (const chunk of stream) {
      if (task && chunk.kind === 'text') {
        if (block !== -1 && chunk.index !== block) streamed += '\n\n'
        block = chunk.index
        streamed += chunk.text
      }
      if (task && chunk.kind === 'tool' && !live && streamed.trim()) {
        live = streamed.trim()
        task.narration.add(live)
        redraw($)
      }
      yield chunk
    }
    const result = await stream.result
    const text = result.answer.trim()
    if (live && live !== text) task?.narration.delete(live)
    if (task && text) {
      if (result.toolUses.length > 0) {
        task.narration.add(text)
      } else {
        task.answers.push(text)
      }
      redraw($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const task = tasks.find((one) => one.turnIds.has(e.turnId))
    if (task) {
      task.isDone = true
      task.isAborted = e.isAborted
      task.durationMs = (await $.clock.now()) - task.startedAt
      if (e.isAborted) {
        task.answers.push(...task.narration)
        task.narration.clear()
      }
      void refreshGit($)
      redraw($)
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as ToolInput
    const task = runningTask()
    if (!task || input.agentId || SKIPPED_STEPS.has(input.tool)) return next(e)
    const change = EDIT_TOOLS.has(input.tool) ? await measure($, input) : undefined
    const step = addStep(task, input)
    redraw($)
    try {
      const result = await next(e)
      if (result.deny || result.isError) step.isFailed = true
      else if (change) recordChange(task, step, input, change)
      return result
    } catch (error) {
      step.isFailed = true
      throw error
    } finally {
      step.pending -= 1
      if (EDIT_TOOLS.has(input.tool) || input.tool === 'Bash') void refreshGit($)
      redraw($)
    }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (KEPT_ROWS.has(e.props.tool)) return next(e)
    return hide($, e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (KEPT_ROWS.has(e.props.tool)) return next(e)
    return hide($, e)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    return hide($, e)
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e) => hide($, e))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => (runningTask() ? hide($, e) : next(e)))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text.trim()
    if (!text) return next(e)
    const owner = ownerOfReply(text)
    if (owner?.isNarration) return hide($, e)
    if (owner) {
      if (fitsPage(owner.task)) return hide($, e)
      if (owner.task !== latestTask() && !owner.task.isOpen) return hide($, e)
      return next(e)
    }
    if (runningTask()) return hide($, e)
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer' || e.props.isExpanded) return next(e)
    const text = e.props.text.trim()
    const task = ownerOfPrompt(e.requestId, text)
    if (!task) return ownerOfFollowUp(text) ? hide($, e) : next(e)
    const now = await $.clock.now()
    if (task === latestTask()) return page($, e, viewedTask() ?? task, now)
    return task.isOpen ? openedFold($, e, task, now) : folded($, e, task)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.props.hasSurvey || tasks.length === 0) return theirs
    const shown = viewedTask()
    if (!shown) return theirs
    const bar = statusline($, e, shown, await $.clock.now())
    return theirs ? stack($, e, [bar, theirs]) : bar
  })
}

function stack($: any, e: any, children: any[]) {
  const { Box } = $.ui.resolve(e)
  return Box({ flexDirection: 'column', children })
}
