import axios from "axios";
import i18n from "./i18n";
// import type { PersistentMap, QuickRobotInfo } from "./types/robot";
import { EVENT_CALLBACKS } from "./http/events";
import { Neato, type QuickRobotInfo } from "./types";
import type * as Gen3 from './types/neato/gen3'
import type * as Gen4 from './types/neato/gen4'
import type { NoGoLine, Zone } from "./pages/map/types";

// Store for loading state callback - will be set by AppContext
let loadingStateCallback: ((state: { isLoading: boolean; message?: string }) => void) | null = null;

const instance = axios.create({
  baseURL: '/api',
});


// Add request interceptor
instance.interceptors.request.use(
  (config) => {
    if (loadingStateCallback) {
      loadingStateCallback({ isLoading: true, message: i18n.t('common.sendingCommand') });
    }
    return config;
  },
  (error) => {
    if (loadingStateCallback) {
      loadingStateCallback({ isLoading: false });
    }
    return Promise.reject(error);
  }
);

// Add response interceptor
instance.interceptors.response.use(
  (response) => {
    if (loadingStateCallback) {
      loadingStateCallback({ isLoading: false });
    }
    return response;
  },
  (error) => {
    if (loadingStateCallback) {
      loadingStateCallback({ isLoading: false });
    }
    return Promise.reject(error);
  }
);

export class Http {
  static sendCmd<T>(robotSerial: string, cmd: object) {
    return instance.post<T>(`/robot/${robotSerial}/command`, JSON.stringify(cmd));
  }

  static getPersistentMaps(serial: string) {
    return instance.get<Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[]>(`/robot/${serial}/maps`)
  }

  static getPersistentMap(serial: string, mapId: string) {
    return instance.get<rle_data>(`/robot/${serial}/maps/${mapId}`) // TODO: type!
  }

  static postUseMapAsFloorPlan(serial: string, mapId: string) {
    return instance.post(`/robot/${serial}/maps/${mapId}/use`)
  }

  static postUnuseMapAsFloorPlan(serial: string, mapId: string) {
    return instance.post(`/robot/${serial}/maps/${mapId}/unuse`)
  }

  static updatePersistentMap(serial: string, mapId: string, data: { name?: string, enabled?: boolean }) {
    return instance.post(`/robot/${serial}/maps/${mapId}`, data)
  }

  static postBoundaries(serial: string, mapId: string, data: (NoGoLine | Zone)[]) {
    return instance.post(`/robot/${serial}/maps/${mapId}/boundaries`, data)
  }

  static getBoundaries(serial: string, mapId: string) {
    return instance.get(`/robot/${serial}/maps/${mapId}/boundaries`)
  }

  static test(serial: string, mapId: string) {
    return instance.get(`/robot/${serial}/maps/${mapId}/test`)
  }

  static getCleanings(serial: string) {
    return instance.get(`/robot/${serial}/runs`)
  }

  static getCleaning(serial: string, runId: string) {
    return instance.get(`/robot/${serial}/run/${runId}`)
  }

  static demoteFloorplan(serial: string, mapId: string) {
    return instance.delete(`/robot/${serial}/maps/${mapId}`)
  }

  static getRobots() {
    return instance.get<QuickRobotInfo>('/robots');
  }

  static updateRobot(serial: string, data: { name: string }) {
    return instance.post(`/robot/${serial}`, data)
  }

  static setLoadingStateCallback(callback: (state: { isLoading: boolean; message?: string }) => void) {
    loadingStateCallback = callback;
  }
}


