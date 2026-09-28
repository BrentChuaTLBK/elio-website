import {deliveryTrackingUrl} from '../delivery-tracking.js';

export function renderOrderTracking(order,{esc,datetime,requested=false}) {
 const closed=order.refund_label||['cancelled','expired','refunded'].includes(order.fulfillment_status);
 const link=deliveryTrackingUrl(order.delivery_tracking_url);
 if(!requested&&(order.method!=='delivery'||closed||(!link&&order.payment_status!=='paid')))return '';
 let message,button='';
 if(order.method!=='delivery')message='This order is scheduled for pickup. See your order details below for collection information.';
 else if(closed)message='Delivery tracking is unavailable because this order is closed. Please contact our kitchen if you need help.';
 else if(link){message=order.fulfillment_status==='completed'?'This delivery has been marked completed. You can open the last courier link below.':'Follow your delivery using the latest tracking link from our kitchen.';button=`<a class="button block" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open courier tracking ↗</a>`;}
 else message=order.fulfillment_status==='completed'?'This delivery has been marked completed. No courier tracking link is available.':'Tracking is not available yet. Please check this page again after our kitchen adds the courier’s tracking link.';
 return `<section id="delivery-tracking" class="panel order-section delivery-tracking" tabindex="-1"><h2>Delivery tracking</h2><p class="muted">${esc(message)}</p>${button}${order.delivery_tracking_updated_at?`<small class="muted">Updated ${datetime(order.delivery_tracking_updated_at)}</small>`:''}</section>`;
}
