# Spec 02 — Theme Identity & Rename

Ticket: #6 · Type: grilling · Branch: `feat/identity`

## Question

What does the renamed theme call itself and how does rename land?

## Decision

- Display name: `pi-tui-theme` (proposed) or keep `pi-skill-desc` with theme description — owner picks via grilling.
- `package.json` `name` stays `pi-skill-desc` for now (avoid registry churn); `description` and README header change to theme framing.
- Command: keep `/model-info` for compat, add `/theme` (lightweight English dialog) that subsumes it. Old command delegates to new.
- Install path `~/.pi/agent/extensions/pi-skill-desc` unchanged; future rename is a symlink alias, not a break.

## Acceptance

- [ ] README header reflects theme identity, install still works via existing path
- [ ] `/theme` command exists (even if dialog lands later — stub with notify)
- [ ] No break for users symlinked to old path
