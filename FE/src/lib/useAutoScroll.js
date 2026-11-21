import { useEffect, useRef } from 'react';

/**
 * Tự cuộn chậm nội dung khi vượt quá chiều cao khung (dùng cho màn hình trình chiếu, không ai thao tác chuột).
 * Dừng ở đầu/cuối vài giây rồi cuộn tiếp. Tạm dừng khi rê chuột vào.
 */
export function useAutoScroll(deps = []) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let dir = 1;
    let pauseUntil = Date.now() + 4000;
    let hovering = false;
    const enter = () => (hovering = true);
    const leave = () => (hovering = false);
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);

    const timer = setInterval(() => {
      if (hovering || Date.now() < pauseUntil) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 2) return;
      el.scrollTop += dir;
      if (dir > 0 && el.scrollTop >= max - 1) {
        dir = -1;
        pauseUntil = Date.now() + 4000;
      } else if (dir < 0 && el.scrollTop <= 0) {
        dir = 1;
        pauseUntil = Date.now() + 4000;
      }
    }, 40);

    return () => {
      clearInterval(timer);
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}
