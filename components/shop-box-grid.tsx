import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { LazyMotion, domAnimation } from "framer-motion";
import { MenuItemCard, type MenuItem } from "@/components/ui/menu-item-card";

export function mountBoxGrid(container: HTMLElement, onAdd: (id: string) => void) {
  const root = createRoot(container);
  return {
    render(items: MenuItem[]) {
      // The existing row entrance and dialog focus restoration read the DOM immediately.
      flushSync(() => root.render(
        <LazyMotion features={domAnimation} strict>
          {items.length ? items.map(item => (
            <MenuItemCard key={item.id} item={item} onAdd={onAdd} />
          )) : (
            <div className="empty-state">
              <h3>No boxes are listed right now.</h3>
              <p>Please check back soon.</p>
            </div>
          )}
        </LazyMotion>
      ));
    },
    unmount() { root.unmount(); }
  };
}
