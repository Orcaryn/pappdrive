// The ready-made sign-in form. Spec 12-implementation.md, Sign-in form:
// - one form for sign-up, sign-in and recovery
// - ships in the package, never loaded from the server, so the password is hashed by library code
// - sign-up shows the recovery code with copy and download buttons, and goes on only once the user
//   types back the last group of the code
// - every error in plain words; plain HTML, no framework; the look is set with --pappdrive-* CSS variables
//
//   import { signInForm } from "pappdrive/ui"
//   await signInForm(document.querySelector("#sign-in"), papp)            // resolves once signed in
//   await signInForm(el, { signUp, signIn, recover })                     // Electron: functions over IPC
import { MIN_PASSWORD_LENGTH } from "@pappdrive/protocol"
import type { SyncError } from "../core/errors.js"
import type { Papp } from "../core/types.js"

export type Mode = "sign-in" | "sign-up" | "recover"

/** The three calls the form needs. A Papp has them; in Electron, pass functions that call the main process. */
export interface AccountFunctions {
  signUp(email: string, password: string): Promise<{ recoveryCode: string }>
  signIn(email: string, password: string): Promise<void>
  recover(email: string, recoveryCode: string, newPassword: string): Promise<void>
}

export interface SignInFormOptions {
  /** The first view. Default "sign-in". */
  mode?: Mode
  /** A name shown in the heading, e.g. "My Notes". */
  appTitle?: string
}

const STYLE_ID = "pappdrive-ui-style"

const CSS = `
:where(.pappdrive-form) {
  --_font: var(--pappdrive-font, system-ui, -apple-system, "Segoe UI", sans-serif);
  --_text: var(--pappdrive-text, #1d1d1f);
  --_muted: var(--pappdrive-muted, #5f6368);
  --_bg: var(--pappdrive-bg, #ffffff);
  --_input-bg: var(--pappdrive-input-bg, #ffffff);
  --_border: var(--pappdrive-border, #c9cdd2);
  --_accent: var(--pappdrive-accent, #1f5fd1);
  --_accent-text: var(--pappdrive-accent-text, #ffffff);
  --_error: var(--pappdrive-error, #b3261e);
  --_focus: var(--pappdrive-focus, #1f5fd1);
  --_radius: var(--pappdrive-radius, 8px);
  --_gap: var(--pappdrive-gap, 14px);
  --_width: var(--pappdrive-width, 22rem);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--_gap);
  max-width: var(--_width);
  padding: var(--pappdrive-padding, 20px);
  font: 15px/1.45 var(--_font);
  color: var(--_text);
  background: var(--_bg);
  border-radius: var(--_radius);
}
:where(.pappdrive-form) * { box-sizing: border-box; }
:where(.pappdrive-form) h2 { margin: 0; font-size: 1.25em; font-weight: 600; }
:where(.pappdrive-form) p { margin: 0; }
:where(.pappdrive-form) .pappdrive-field { display: flex; flex-direction: column; gap: 4px; }
:where(.pappdrive-form) label { font-weight: 500; }
:where(.pappdrive-form) .pappdrive-hint { color: var(--_muted); font-size: 0.9em; }
:where(.pappdrive-form) input {
  font: inherit; color: var(--_text); background: var(--_input-bg);
  border: 1px solid var(--_border); border-radius: var(--_radius); padding: 9px 11px; width: 100%;
}
:where(.pappdrive-form) input[aria-invalid="true"] { border-color: var(--_error); }
:where(.pappdrive-form) :focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
:where(.pappdrive-form) button {
  font: inherit; cursor: pointer; border-radius: var(--_radius); padding: 9px 14px;
  border: 1px solid var(--_border); background: transparent; color: var(--_text);
}
:where(.pappdrive-form) button.pappdrive-primary { background: var(--_accent); color: var(--_accent-text); border-color: var(--_accent); font-weight: 600; }
:where(.pappdrive-form) button:disabled { opacity: 0.6; cursor: progress; }
:where(.pappdrive-form) button.pappdrive-link { border: none; padding: 2px 0; color: var(--_accent); text-decoration: underline; text-align: left; }
:where(.pappdrive-form) .pappdrive-row { display: flex; gap: 8px; flex-wrap: wrap; }
:where(.pappdrive-form) .pappdrive-links { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
:where(.pappdrive-form) .pappdrive-error { color: var(--_error); font-weight: 500; }
:where(.pappdrive-form) .pappdrive-error:empty, :where(.pappdrive-form) .pappdrive-status:empty { display: none; }
:where(.pappdrive-form) .pappdrive-status { color: var(--_muted); }
:where(.pappdrive-form) code {
  font-family: var(--pappdrive-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 0.95em; background: var(--pappdrive-code-bg, #f1f3f4); padding: 1px 5px; border-radius: 4px;
  user-select: all; word-break: break-all;
}
:where(.pappdrive-form) .pappdrive-code {
  display: block; text-align: center; font-size: 1.2em; letter-spacing: 0.06em; padding: 12px;
  border: 1px dashed var(--_border); border-radius: var(--_radius);
  font-family: var(--pappdrive-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  user-select: all; word-break: break-all;
}
`

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement("style")
  style.id = STYLE_ID
  style.textContent = CSS
  // First in <head>, so the app's own rules win at the same specificity.
  doc.head.insertBefore(style, doc.head.firstChild)
}

let counter = 0

type Attrs = Record<string, string | boolean | undefined>

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    node.setAttribute(k, v === true ? "" : v)
  }
  for (const kid of kids) node.append(kid)
  return node
}

/**
 * Shows the form in `element` and resolves once the user is signed in (after a sign-up: once the
 * recovery code is confirmed). `account` is a Papp, or `{ signUp, signIn, recover }`.
 */
export async function signInForm(element: HTMLElement, account: Papp | AccountFunctions, options: SignInFormOptions = {}): Promise<void> {
  if ("ready" in account) {
    await account.ready
    if (account.signedIn) return
  }

  const doc = element.ownerDocument
  injectStyle(doc)
  const uid = `pappdrive-${++counter}`

  return new Promise<void>((resolve) => {
    const form = el(doc, "form", { class: "pappdrive-form", novalidate: true, "aria-labelledby": `${uid}-title` })
    element.replaceChildren(form)
    let mode: Mode = options.mode ?? "sign-in"
    let busy = false
    let lastEmail = ""

    const finish = () => {
      element.replaceChildren()
      resolve()
    }

    // ---------- shared pieces ----------

    const errorBox = () => el(doc, "div", { class: "pappdrive-error", id: `${uid}-error`, role: "alert", "aria-live": "assertive" })

    const field = (id: string, label: string, input: Attrs, hint?: string) => {
      const inputEl = el(doc, "input", { id: `${uid}-${id}`, name: id, ...input, "aria-describedby": hint ? `${uid}-${id}-hint ${uid}-error` : `${uid}-error` })
      const wrap = el(doc, "div", { class: "pappdrive-field" }, el(doc, "label", { for: `${uid}-${id}` }, label), inputEl)
      if (hint) wrap.append(el(doc, "span", { class: "pappdrive-hint", id: `${uid}-${id}-hint` }, hint))
      return { wrap, input: inputEl }
    }

    const showError = (box: HTMLElement, text: string, command?: string, invalid?: HTMLInputElement | null, all: HTMLInputElement[] = []) => {
      for (const i of all) i.removeAttribute("aria-invalid")
      box.replaceChildren(text)
      if (command) box.append(" ", el(doc, "code", {}, command))
      if (invalid) {
        invalid.setAttribute("aria-invalid", "true")
        invalid.focus()
      }
    }

    const modeLink = (text: string, to: Mode) => {
      const b = el(doc, "button", { type: "button", class: "pappdrive-link" }, text)
      b.addEventListener("click", () => {
        if (busy) return
        mode = to
        render()
      })
      return b
    }

    // ---------- sign-in, sign-up, recover ----------

    const render = () => {
      form.onsubmit = null
      const title = {
        "sign-in": options.appTitle ? `Sign in to ${options.appTitle}` : "Sign in",
        "sign-up": "Create an account",
        recover: "Set a new password with your recovery code",
      }[mode]
      const intro = {
        "sign-in": "Your files sync between your devices, encrypted. Only your password opens them.",
        "sign-up": "Your files are encrypted on this device. Nobody else can read them, not even the server.",
        recover: "Use the recovery code you saved when you created the account. It sets a new password on this device.",
      }[mode]
      const email = field("email", "Email", { type: "email", autocomplete: "email", required: true, inputmode: "email", spellcheck: "false", autocapitalize: "off", value: lastEmail })
      const inputs = [email.input]
      const kids: Node[] = [el(doc, "h2", { id: `${uid}-title` }, title), el(doc, "p", { class: "pappdrive-hint" }, intro), email.wrap]
      let code: HTMLInputElement | null = null
      if (mode === "recover") {
        const c = field(
          "code",
          "Recovery code",
          { type: "text", autocomplete: "off", required: true, spellcheck: "false", autocapitalize: "characters" },
          "26 letters and digits, like ABCDE-FGHJK-…",
        )
        code = c.input
        inputs.push(code)
        kids.push(c.wrap)
      }
      const pw =
        mode === "sign-in"
          ? field("password", "Password", { type: "password", autocomplete: "current-password", required: true })
          : field("password", mode === "recover" ? "New password" : "Password", { type: "password", autocomplete: "new-password", required: true, minlength: String(MIN_PASSWORD_LENGTH) }, `At least ${MIN_PASSWORD_LENGTH} characters. A few random words work well.`)
      inputs.push(pw.input)
      kids.push(pw.wrap)
      const err = errorBox()
      const submitText = { "sign-in": "Sign in", "sign-up": "Create account", recover: "Set new password" }[mode]
      const busyText = { "sign-in": "Signing in…", "sign-up": "Creating the account…", recover: "Checking the code…" }[mode]
      const submit = el(doc, "button", { type: "submit", class: "pappdrive-primary" }, submitText)
      const status = el(doc, "p", { class: "pappdrive-status", "aria-live": "polite" })
      kids.push(err, submit, status)
      const links = el(doc, "div", { class: "pappdrive-links" })
      if (mode !== "sign-in") links.append(modeLink("I have an account: sign in", "sign-in"))
      if (mode !== "sign-up") links.append(modeLink("New here? Create an account", "sign-up"))
      if (mode !== "recover") links.append(modeLink("Forgot the password? Use the recovery code", "recover"))
      kids.push(links)
      form.replaceChildren(...kids)

      form.onsubmit = async (ev) => {
        ev.preventDefault()
        if (busy) return
        const emailValue = email.input.value.trim()
        lastEmail = emailValue
        const password = pw.input.value
        if (!emailValue.includes("@")) return showError(err, "Enter your email address.", undefined, email.input, inputs)
        if (code && !code.value.trim()) return showError(err, "Enter your recovery code.", undefined, code, inputs)
        if (!password) return showError(err, mode === "recover" ? "Choose a new password." : "Enter your password.", undefined, pw.input, inputs)
        showError(err, "", undefined, null, inputs)
        busy = true
        submit.disabled = true
        form.setAttribute("aria-busy", "true")
        submit.textContent = busyText
        status.textContent = "This takes a few seconds: your password is turned into a key on this device."
        try {
          if (mode === "sign-in") {
            await account.signIn(emailValue, password)
            finish()
          } else if (mode === "recover") {
            await account.recover(emailValue, code!.value.trim(), password)
            finish()
          } else {
            const { recoveryCode } = await account.signUp(emailValue, password)
            showRecovery(recoveryCode, emailValue)
          }
        } catch (e) {
          busy = false
          submit.disabled = false
          form.removeAttribute("aria-busy")
          submit.textContent = submitText
          status.textContent = ""
          const { text, field: bad, command } = errorText(e, mode)
          const target = bad === "email" ? email.input : bad === "password" ? pw.input : bad === "code" ? code : null
          showError(err, text, command, target, inputs)
        }
      }
      email.input.value ? pw.input.focus() : email.input.focus()
    }

    // ---------- the recovery code, after sign-up ----------

    const showRecovery = (recoveryCode: string, email: string) => {
      const group = recoveryCode.split("-").at(-1)!
      const codeBox = el(doc, "output", { class: "pappdrive-code", "aria-label": "Your recovery code" }, recoveryCode)
      const status = el(doc, "p", { class: "pappdrive-status", "aria-live": "polite" })
      const copy = el(doc, "button", { type: "button" }, "Copy")
      const download = el(doc, "button", { type: "button" }, "Download")
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(recoveryCode)
          status.textContent = "Copied. Paste it somewhere safe, like a password manager."
        } catch {
          const range = doc.createRange()
          range.selectNodeContents(codeBox)
          const sel = doc.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(range)
          status.textContent = "Copying is blocked here. The code is selected: press Ctrl+C or Cmd+C."
        }
      })
      download.addEventListener("click", () => {
        const text =
          `Recovery code${options.appTitle ? ` for ${options.appTitle}` : ""}\n\n` +
          `Account: ${email}\nCode: ${recoveryCode}\n\n` +
          "This code sets a new password if you forget yours. Nobody can reset the password for you,\n" +
          "not even the server. Keep this file somewhere safe, not only on this device.\n"
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }))
        const a = el(doc, "a", { href: url, download: "recovery-code.txt" })
        doc.body.append(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        status.textContent = "Downloaded recovery-code.txt. Move it somewhere safe."
      })
      const back = field(
        "confirm",
        "Type the last group of the code",
        { type: "text", autocomplete: "off", required: true, spellcheck: "false", autocapitalize: "characters", maxlength: String(group.length + 4) },
        `The ${group.length} characters after the last dash. This checks that you saved it.`,
      )
      const err = errorBox()
      const submit = el(doc, "button", { type: "submit", class: "pappdrive-primary" }, "Continue")
      form.replaceChildren(
        el(doc, "h2", { id: `${uid}-title` }, "Save your recovery code"),
        el(
          doc,
          "p",
          {},
          "If you forget your password, this code is the only way back into your files. Nobody can reset it for you. Save it now, away from this device.",
        ),
        codeBox,
        el(doc, "div", { class: "pappdrive-row" }, copy, download),
        status,
        back.wrap,
        err,
        submit,
      )
      form.onsubmit = (ev) => {
        ev.preventDefault()
        if (matchesGroup(back.input.value, group)) return finish()
        showError(
          err,
          back.input.value.trim()
            ? "That does not match the last group of the code. Look at the code above and type the part after the last dash."
            : "Type the last group of the code to continue.",
          undefined,
          back.input,
          [back.input],
        )
      }
      copy.focus()
    }

    render()
  })
}

// ---------- texts ----------

/**
 * What the user reads for a failed call, and which input to mark as wrong. Errors are matched by
 * `code`; in Electron the window throws them again with the same code (examples/journal-electron).
 */
export function errorText(err: unknown, mode: Mode): { text: string; field?: "email" | "password" | "code"; command?: string } {
  const { code, message, retryAfter = 60 } = err as Partial<SyncError>
  switch (code) {
    case "credentials":
      return mode === "recover"
        ? { text: "The email or the recovery code is wrong. Check both against your saved copy of the code.", field: "code" }
        : { text: "Wrong email or password. Try again, or use your recovery code if you forgot the password.", field: "password" }
    case "exists":
      return { text: "An account with this email already exists. Sign in instead.", field: "email" }
    case "weak-password":
      return { text: `The password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters. A few random words work well.`, field: "password" }
    case "rate-limited": {
      const minutes = Math.ceil(retryAfter / 60)
      const wait = retryAfter < 60 ? `${retryAfter} second${retryAfter === 1 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`
      return { text: `Too many tries. Wait ${wait}, then try again.` }
    }
    case "no-app": {
      // The library's message names the command that creates the app.
      const command = /npx pappdrive-cli apps create ([a-z0-9-]+)/.exec(message!)
      if (!command) break
      return { text: `The app "${command[1]}" is not created yet. Create it in a terminal with this command, then try again:`, command: command[0] }
    }
    case "network":
      return { text: "You seem to be offline, or the sync server cannot be reached. Check the connection and try again." }
    case "gone":
      return { text: "This account or app folder was deleted. Sign up again to start a new, empty folder." }
    case "update-needed":
      return { text: "This app needs an update to sync. Update it, then try again." }
    case "server":
      return { text: "The sync server had a problem. Try again in a minute." }
  }
  return { text: `Something went wrong: ${message ?? String(err)}` }
}

/** Did the user type back the last group of the code? Crockford base32: case and dashes ignored, I and L read as 1, O as 0. */
export function matchesGroup(typed: string, lastGroup: string): boolean {
  const normalize = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "")
      .replace(/[IL]/g, "1")
      .replace(/O/g, "0")
  const t = normalize(typed)
  return t.length > 0 && t === normalize(lastGroup)
}
