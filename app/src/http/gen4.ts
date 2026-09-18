import { Http } from "../http"
import type { Neato } from "../types"
import type { RobotBaseResponse } from "../types/neato/gen3"


function getRobotState(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotStateResponse>(serial, {
        ability: "state.show",
    })
}

function findMe(serial: string) {
    return Http.sendCmd(serial, {
        ability: "utilities.find_me",
    })
}

function getSchedule(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "scheduling.show",
    })
}

function sendToBase(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "navigation.return_to_base",
    })
}

function updateOrAddSchduledEvent(serial: string, event: Neato.Gen4.CommandEvent) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "scheduling.update",
        event,
    })
}

function deleteScheduledEvent(serial: string, id: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "scheduling.delete",
        id,
    })
}

function stopCleaning(serial: string) {
    return Http.sendCmd(serial, {
        ability: "cleaning.cancel",
    })
}

function pauseCleaning(serial: string) {
    return Http.sendCmd(serial, {
        ability: "cleaning.pause",
    })
}

function resumeCleaning(serial: string) {
    return Http.sendCmd(serial, {
        ability: "cleaning.resume",
    })
}


function getSettings<Op extends Neato.Gen4.SettingsGetOperation>(serial: string, settings: Neato.Gen4.RobotSettingsGet<Op>) {
    return Http.sendCmd<Neato.Gen4.BaseResponse<Neato.Gen4.SettingsMap[Op]>>(serial, {
        ability: settings.operation,
    })
}

function setSettings<Op extends Neato.Gen4.SettingsSetOperation>(serial: string, settings: Neato.Gen4.RobotSettingsSet<Op>) {
    return Http.sendCmd<Neato.Gen4.BaseResponse<Neato.Gen4.SettingsMap[Op]>>(serial, {
        ability: settings.operation,
        ...settings.values
    })
}

function factoryReset(serial: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "settings.factory_reset"
    })
}

function demoteFloorplan(serial: string, id: string) {
    return Http.sendCmd<Neato.Gen4.GetRobotScheduleResponse>(serial, {
        ability: "maps.demote_floorplan",
        rank_uuid: id,
    })
}


function startCleaning(serial: string, mode: Neato.Gen4.CleaningMode, navigationMode: Neato.Gen4.CleaningNavigationMode, trackId?: string | null, rankId?: string | null) {
    // Zone cleaning needs a floorplan rank_id AND the zone uploaded to the robot
    // as a track (maps.save_track) - not wired yet (scope B). Guard so clicking a
    // zone doesn't fall through to a full exploration clean.
    if (trackId && !rankId) {
        console.warn('startCleaning: zone cleaning not implemented yet (needs a promoted map + save_track)')
        return Promise.resolve()
    }
    // rankId set  -> clean that persistent floorplan (track_id null = whole map).
    // rankId null -> non-persistent / first-map exploration clean (map: null).
    const map = rankId
        ? { rank_id: rankId, track_id: trackId ?? null, nogo_enabled: true }
        : null
    return Http.sendCmd(serial, {
        ability: "cleaning.start",
        force_floorplan: false,
        runs: [{
            map,
            settings: {
                mode,
                navigation_mode: navigationMode,
            },
        }]
    })
}

function cleaningInfo(serial: string) {
    return Http.sendCmd<RobotBaseResponse<Neato.Gen4.Cleaning>>(serial, {
        ability: "cleaning.show",
    })
}


export const GEN4_COMMANDS = {
    startCleaning,
    stopCleaning,
    pauseCleaning,
    resumeCleaning,
    cleaningInfo,
    sendToBase,

    getSchedule,
    updateOrAddSchduledEvent,
    deleteScheduledEvent,
    
    demoteFloorplan,
    getSettings,
    setSettings,
    
    getRobotState,
    findMe,

    factoryReset
}
