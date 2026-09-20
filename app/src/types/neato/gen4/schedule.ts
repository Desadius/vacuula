import type { CleaningMode, CleaningNavigationMode } from "./state";


export interface ScheduledCommands {
    enabled: boolean;
    events:  CommandEvent[];
}

export enum Days {
    MONDAY = "mon",
    TUESDAY = "tue",
    WEDNESDAY = "wed",
    THURSDAY = "thu",
    FRIDAY = "fri",
    SATURDAY = "sat",
    SUNDAY = "sun"
}

export interface CommandEvent {
    id?:      string;
    enabled: boolean;
    days:    Days[];
    time:    string; // HH:MM
    command: Command;
}

export interface Command {
    ability:           string; // TODO: fix
    auto_localization: boolean;
    force_floorplan:   boolean;
    runs:              SchduleRun[];
}

export interface SchduleRun {
    settings: RunSettings;
    map?:      RunMap;
}

export interface RunMap {
    rank_id:      string;
    track_id:     string | null;
    nogo_enabled: boolean;
}

export interface RunSettings {
    mode:            CleaningMode;
    navigation_mode: CleaningNavigationMode;
}



