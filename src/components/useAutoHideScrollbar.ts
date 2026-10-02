import { useEffect, type RefObject } from "react";
import { cssMs } from "../app/cssTokens";

/** Shows the overlay scrollbar while scrolling, hides it after inactivity [DESIGN §2.23]. */
export function attachAutoHideScrollbar(el: HTMLElement): () => void {
  el.classList.add("u-scroll");
  let timer: number | undefined;
  const onScroll = () => {
    el.classList.add("is-scrolling");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove("is-scrolling"), cssMs("--scrollbar-hide-delay"));
  };
  el.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    window.clearTimeout(timer);
    el.removeEventListener("scroll", onScroll);
  };
}

export function useAutoHideScrollbar(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => (ref.current ? attachAutoHideScrollbar(ref.current) : undefined), [ref]);
}
