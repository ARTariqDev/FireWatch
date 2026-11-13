import gsap from "gsap";

const LINES = "[data-title-line]";
const PARTS = "[data-copy-part]";

// Title lines tilt up out of their masks, then the supporting copy wipes in beneath them.
export function playCopyIn(root, delay = 0) {
  const pick = gsap.utils.selector(root);
  gsap.set(root, { visibility: "visible" });

  return gsap
    .timeline({
      delay,
      // Drop the clip and transforms so hover states (e.g. the button) are never cut off.
      onComplete: () => gsap.set([...pick(LINES), ...pick(PARTS)], { clearProps: "clipPath,transform" }),
    })
    .fromTo(
      pick(LINES),
      { yPercent: 118, rotateX: -68, skewY: 7 },
      { yPercent: 0, rotateX: 0, skewY: 0, duration: 1.15, stagger: 0.12, ease: "power4.out" },
    )
    .fromTo(
      pick(PARTS),
      { clipPath: "inset(0 100% 0 0)", x: -26 },
      { clipPath: "inset(0 0% 0 0)", x: 0, duration: 0.8, stagger: 0.1, ease: "power2.inOut" },
      "-=0.7",
    );
}

export function playCopyOut(root) {
  const pick = gsap.utils.selector(root);

  return gsap
    .timeline({ onComplete: () => gsap.set(root, { visibility: "hidden" }) })
    .to(pick(LINES), {
      yPercent: -118,
      rotateX: 60,
      skewY: -6,
      duration: 0.7,
      stagger: 0.07,
      ease: "power3.in",
    })
    .to(
      pick(PARTS),
      { clipPath: "inset(0 0 0 100%)", x: -34, duration: 0.6, stagger: 0.06, ease: "power2.inOut" },
      0,
    );
}
