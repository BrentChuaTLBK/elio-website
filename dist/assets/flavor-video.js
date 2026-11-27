import { config } from './admin/config.js';

export const flavorVideoBucket = 'flavor-videos';
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const objectKey = new RegExp(`^${uuid}/${uuid}\\.(mp4|webm|mov)$`);
export function flavorVideoUrl(path) {
  return typeof path === 'string' && objectKey.test(path)
    ? `${config.supabaseUrl}/storage/v1/object/public/${flavorVideoBucket}/${path}` : '';
}
