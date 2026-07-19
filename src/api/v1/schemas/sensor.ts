/**
 * Sensor / event service schemas — seismology, climate, cyber, aviation.
 * Shapes follow World Monitor service response conventions (typed lists + fetchedAt).
 */

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface EarthquakeEvent {
  id: string;
  title: string;
  magnitude: number;
  depthKm?: number;
  place: string;
  publishedAt: number;
  location?: GeoCoordinates;
  sourceUrl?: string;
  severity: string;
}

export interface ListEarthquakesResponse {
  earthquakes: EarthquakeEvent[];
  fetchedAt: string;
  dataAvailable: boolean;
}

export interface ClimateDisasterEvent {
  id: string;
  title: string;
  summary: string;
  alertLevel?: string;
  publishedAt: number;
  location?: GeoCoordinates;
  locationName?: string;
  sourceUrl?: string;
  severity: string;
}

export interface ListClimateDisastersResponse {
  disasters: ClimateDisasterEvent[];
  fetchedAt: string;
  dataAvailable: boolean;
}

export interface CyberThreatEvent {
  id: string;
  title: string;
  summary: string;
  indicator?: string;
  malware?: string;
  publishedAt: number;
  location?: GeoCoordinates;
  locationName?: string;
  sourceUrl?: string;
  severity: string;
}

export interface ListCyberThreatsResponse {
  threats: CyberThreatEvent[];
  fetchedAt: string;
  dataAvailable: boolean;
}

export interface AircraftPosition {
  id: string;
  callsign: string;
  icao24: string;
  aircraftType?: string;
  altitudeM?: number;
  velocityMs?: number;
  publishedAt: number;
  location: GeoCoordinates;
}

export interface ListAircraftPositionsResponse {
  positions: AircraftPosition[];
  fetchedAt: string;
  dataAvailable: boolean;
}
