# Terminal Setup

Dot works best in a terminal with truecolor, bracketed paste, OSC 8 hyperlinks, and modern keyboard reporting.

## Recommended settings

- Set `TERM` to an appropriate value such as `xterm-256color`.
- Set `COLORTERM=truecolor` when the terminal supports 24-bit color.
- Use a terminal and font that support the characters used by the TUI.
- In tmux, follow [tmux setup](tmux.md).
- On Windows, follow [Windows setup](windows.md).

## Multiline input

Use Shift+Enter. Windows Terminal may require Ctrl+Enter depending on its keybindings.

## Hardware cursor

Set `DOT_HARDWARE_CURSOR=1` or enable `showHardwareCursor` when an input method editor needs a visible terminal cursor.

## Debugging

Set `DOT_TUI_WRITE_LOG=/tmp/dot-tui.log` to capture the raw terminal output stream.
