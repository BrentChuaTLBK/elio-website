import { useId, useState } from "react";
import { m, useReducedMotion } from "framer-motion";
import { Clock, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  id: string;
  name: string;
  price: string;
  fromPrice: boolean;
  quantityLabel: string;
  description?: string;
  prepTime?: string;
  notice?: string;
  photo?: { src: string; srcSet?: string; sizes?: string };
  label?: { text: string; color: string; textColor: string } | null;
}

interface MenuItemCardProps {
  item: MenuItem;
  onAdd: (id: string) => void;
  className?: string;
}

export function MenuItemCard({ item, onAdd, className }: MenuItemCardProps) {
  const descriptionId = useId();
  const reducedMotion = useReducedMotion();
  const [failedPhoto, setFailedPhoto] = useState("");
  const photo = item.photo?.src && item.photo.src !== failedPhoto ? item.photo : undefined;

  return (
    <m.button
      type="button"
      className={cn("elio-product-card elio-menu-card", className)}
      data-product={item.id}
      aria-label={"Add " + item.name}
      aria-haspopup="dialog"
      aria-controls="product-dialog"
      aria-describedby={descriptionId}
      onClick={() => onAdd(item.id)}
      whileTap={reducedMotion ? undefined : { scale: 0.99 }}
      transition={{ duration: 0.12 }}
    >
      <span className="elio-product-media">
        {photo ? (
          <img
            src={photo.src}
            srcSet={photo.srcSet}
            sizes={photo.sizes}
            loading="lazy"
            decoding="async"
            alt=""
            onError={() => setFailedPhoto(photo.src)}
          />
        ) : (
          <span className="elio-menu-placeholder">
            <ShoppingBag size={22} strokeWidth={1.4} aria-hidden="true" />
            Photo coming soon
          </span>
        )}
        {item.label && (
          <span className="badge product-label" style={{ backgroundColor: item.label.color, color: item.label.textColor }}>
            {item.label.text}
          </span>
        )}
        <span className="elio-menu-add" aria-hidden="true">Add</span>
      </span>
      <span className="elio-product-copy" id={descriptionId}>
        <span className="elio-menu-price">
          {item.fromPrice && <span className="elio-menu-from">From </span>}
          {item.price}
        </span>
        {item.quantityLabel && <span className="elio-menu-size">{item.quantityLabel}</span>}
        <span className="elio-menu-name" aria-hidden="true">{item.name}</span>
        {item.description && <span className="elio-product-description">{item.description}</span>}
        {item.prepTime && (
          <span className="elio-menu-prep">
            <Clock size={14} strokeWidth={1.6} aria-hidden="true" />
            {item.prepTime}
          </span>
        )}
        {item.notice && <span className="availability unavailable">{item.notice}</span>}
      </span>
    </m.button>
  );
}
