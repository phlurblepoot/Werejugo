/** Where the map was last looking, so place search can put nearby places first. */
let centre: [number, number] | null = null;

export const setMapCentre = (lng: number, lat: number) => { centre = [lng, lat]; };
export const mapCentre = (): [number, number] | null => centre;
