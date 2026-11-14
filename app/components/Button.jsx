"use client";

import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import "./button.css";

gsap.registerPlugin(useGSAP);

const Button = ({
  text,
  glowColor = "#ff6a32",
  onClick,
  disabled = false,
  color = "#000000",
  textColor = "#ff6a32",
  rippleColor = "rgba(255, 106, 50, 0.3)",
}) => {
  const btnRef = useRef(null);
  const glowRef = useRef(null);
  const sheenRef = useRef(null);
  const interactionRef = useRef(null);
  const isActiveRef = useRef(false);
  const nextRippleId = useRef(0);
  const [ripples, setRipples] = useState([]);

  useGSAP(
    (_, contextSafe) => {
      const button = btnRef.current;
      const glow = glowRef.current;
      const sheen = sheenRef.current;

      if (!button || !glow || !sheen) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.set(sheen, { xPercent: -160 });
      gsap
        .timeline({ delay: 0.12 })
        .to(sheen, {
          xPercent: 160,
          opacity: 0.75,
          duration: 0.85,
          ease: "power2.inOut",
        })
        .to(sheen, { opacity: 0, duration: 0.22 }, "-=0.16");

      const animateInteraction = contextSafe((active) => {
        gsap.to(button, {
          scale: active ? 1.035 : 1,
          y: active ? -2 : 0,
          duration: active ? 0.2 : 0.24,
          ease: active ? "power2.out" : "power2.inOut",
          overwrite: "auto",
        });
        gsap.to(glow, {
          opacity: active ? 0.9 : 0,
          scale: active ? 1 : 0.94,
          duration: 0.22,
          ease: "power2.out",
          overwrite: "auto",
        });
      });

      const animateClick = contextSafe(() => {
        const activeScale = isActiveRef.current ? 1.035 : 1;
        const activeY = isActiveRef.current ? -2 : 0;
        gsap
          .timeline({ defaults: { overwrite: "auto" } })
          .to(button, { scale: 0.96, y: 0, duration: 0.08, ease: "power1.in" })
          .to(button, {
            scale: activeScale,
            y: activeY,
            duration: 0.38,
            ease: "back.out(2)",
          });
      });

      interactionRef.current = { animateInteraction, animateClick };
      return () => {
        interactionRef.current = null;
      };
    },
    { scope: btnRef },
  );

  const handlePointerMove = (e) => {
    if (e.pointerType !== "mouse" || !btnRef.current) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    btnRef.current.style.setProperty("--x", `${x}px`);
    btnRef.current.style.setProperty("--y", `${y}px`);
  };

  const handlePointerLeave = (e) => {
    e.currentTarget.style.setProperty("--x", "50%");
    e.currentTarget.style.setProperty("--y", "50%");
    isActiveRef.current = e.currentTarget.matches(":focus-visible");
    interactionRef.current?.animateInteraction(isActiveRef.current);
  };

  const handleInteractionStart = () => {
    if (disabled) return;
    isActiveRef.current = true;
    interactionRef.current?.animateInteraction(true);
  };

  const handleInteractionEnd = () => {
    isActiveRef.current = false;
    interactionRef.current?.animateInteraction(false);
  };

  const handleClick = (e) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isKeyboardClick = e.detail === 0;
    const x = isKeyboardClick ? rect.width / 2 : e.clientX - rect.left;
    const y = isKeyboardClick ? rect.height / 2 : e.clientY - rect.top;
    const id = nextRippleId.current++;
    onClick?.();
    interactionRef.current?.animateClick();

    setRipples((prev) => [...prev, { id, x, y }]);
  };

  return (
    <button
      ref={btnRef}
      type="button"
      disabled={disabled}
      onPointerEnter={handleInteractionStart}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onFocus={(e) => e.currentTarget.matches(":focus-visible") && handleInteractionStart()}
      onBlur={handleInteractionEnd}
      onClick={handleClick}
      className="custom-btn"
      style={{
        background: color,
      }}
    >
      <span
        ref={sheenRef}
        aria-hidden="true"
        className="custom-btn-sheen"
      />

      <span
        ref={glowRef}
        aria-hidden="true"
        className="custom-btn-glow"
        style={{
          borderColor: glowColor,
          maskImage: "radial-gradient(130px at var(--x, 50%) var(--y, 50%), white 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(130px at var(--x, 50%) var(--y, 50%), white 0%, transparent 70%)",
          boxShadow: `0 0 12px ${glowColor}`,
        }}
      />

      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          aria-hidden="true"
          className="button-ripple"
          style={{
            position: "absolute",
            zIndex: 0,
            borderRadius: "50%",
            pointerEvents: "none",
            left: ripple.x - 50,
            top: ripple.y - 50,
            width: 100,
            height: 100,
            backgroundColor: rippleColor,
          }}
          onAnimationEnd={() =>
            setRipples((prev) => prev.filter((item) => item.id !== ripple.id))
          }
        />
      ))}

      <span
        className="custom-btn-text"
        style={{ color: textColor }}
      >
        {text}
      </span>
    </button>
  );
};

export default Button;
