// Each ticket answers the hand: it tilts toward the pointer or the finger and
// settles back when it leaves. Everything else (lift, sheen, parallax) is CSS
// driven from the --rx / --ry / --lift custom properties set here.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (n: number): number => Math.max(-1, Math.min(1, n));

for (const ticket of document.querySelectorAll<HTMLAnchorElement>(".ticket")) {
  let rx = 0;
  let ry = 0;
  let frame = 0;

  const paint = (): void => {
    frame = 0;
    ticket.style.setProperty("--rx", rx.toFixed(3));
    ticket.style.setProperty("--ry", ry.toFixed(3));
  };

  // Aim from the ticket's centre, which the tilt does not move, against the
  // untransformed size, so a tilted ticket does not feed back into itself.
  const aim = (event: PointerEvent): void => {
    const rect = ticket.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    rx = clamp((event.clientX - cx) / (ticket.offsetWidth / 2));
    ry = clamp((event.clientY - cy) / (ticket.offsetHeight / 2));
    if (!frame) frame = requestAnimationFrame(paint);
  };

  const rest = (): void => {
    rx = 0;
    ry = 0;
    delete ticket.dataset.active;
    if (frame) cancelAnimationFrame(frame);
    paint();
  };

  ticket.addEventListener("pointerenter", (event) => {
    if (reduceMotion.matches) return;
    ticket.dataset.active = "";
    aim(event);
  });
  ticket.addEventListener("pointermove", (event) => {
    if ("active" in ticket.dataset) aim(event);
  });
  ticket.addEventListener("pointerleave", rest);
  ticket.addEventListener("pointercancel", rest);
}
