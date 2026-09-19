import { createContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Http } from '../http'
import { GEN3_COMMANDS } from '../http/gen3'
import type { UseState } from '../pages/map/types'
import { Neato, RobotType, type QuickRobotInfo, type Robot } from '../types'
import { GEN4_COMMANDS } from '../http/gen4'
import { OrbitalServices, type AnyEvent } from '../types/neato/gen4'
import { persistentMapsLoader } from '../loaders/resources'
import { useTheme } from '../theme'

interface AppContextType {
    robot?: Robot,
    robots?: QuickRobotInfo,
    selectRobot: (serial: string) => void,
    updateRobotName: (name: string) => Promise<void>
    lastHeartbeat?: number,

    persistentMaps?: (Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[])

    setPersistentMaps: UseState<(Neato.Gen3.PersistentMap[] | Neato.Gen4.Floorplan[]) | undefined>

    cleanings?: Neato.Gen4.Cleaning[]
    setCleanings: UseState<Neato.Gen4.Cleaning[] | undefined>

    userId: string | null
    setUserId: (id: string | null) => void

    isDarkMode: boolean
    setIsDarkMode: (dark: boolean) => void

    isLoading: boolean
    setIsLoading: (loading: boolean) => void
    loadingState: { isLoading: boolean, message?: string }
    setLoadingState: (state: { isLoading: boolean, message?: string }) => void

    message: string | null
    setMessage: (msg: string | null) => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
    const [robot, setRobot] = useState<Robot>()
    const [robots, setRobots] = useState<QuickRobotInfo>()
    const [lastHeartbeat, setLastHeartbeat] = useState<number | undefined>()
    // const [persistentMaps, setPersistentMaps] = useState<PersistentMap[]>()
    const [cleanings, setCleanings] = useState<Neato.Gen4.Cleaning[]>()

    const [userId, setUserId] = useState<string | null>(null)
    const { isDark: isDarkMode, setTheme } = useTheme()
    const setIsDarkMode = (dark: boolean) => setTheme(dark ? 'dark' : 'light')
    const [isLoading, setIsLoading] = useState(false)
    const [loadingState, setLoadingState] = useState<{ isLoading: boolean, message?: string }>({ isLoading: false })
    const [message, setMessage] = useState<string | null>(null)

    useEffect(() => {
        Http.setLoadingStateCallback(setLoadingState)
    }, [])

    // True while a connect attempt is in flight (manual pick or auto-select), so
    // the auto-select effect below can't override the choice while `robot` is
    // briefly undefined. Cleared when a robot is set, or here if the fetch fails.
    const connectingRef = useRef(false)

    const connectToRobot = (serial: string, type: RobotType, name: string) => {
        connectingRef.current = true
        setRobot(undefined)

        if (type === RobotType.NeatoGen3) {
            GEN3_COMMANDS.getRobotState(serial).then((res) => {
                setRobot({
                    type: RobotType.NeatoGen3,
                    serial,
                    name: name,
                    availableCommands: res.data.availableCommands,
                    details: res.data.details,
                    alert: res.data.alert,
                    error: res.data.error,
                    state: res.data.state,
                    action: res.data.action,
                })
            }).catch((err) => {
                console.error('Failed to connect to robot', err)
                connectingRef.current = false
            })
        } else if (type === RobotType.NeatoGen4) {
            GEN4_COMMANDS.getRobotState(serial).then((res) => {
                const body = res.data.body
                setRobot({
                    type: RobotType.NeatoGen4,
                    serial,
                    name: name,
                    availableCommands: body.available_commands,
                    details: body.details,
                    errors: body.errors ?? undefined,
                    state: body.state,
                    action: body.action,
                })
            }).catch((err) => {
                console.error('Failed to connect to robot', err)
                connectingRef.current = false
            })
        }
    }

    const selectRobot = (serial: string) => {
        const target = robots?.[serial]
        if (!target || !target.connected) return; // guard: can't select an offline/unknown robot
        connectToRobot(serial, target.type, target.name)
    }

    // Renames the currently-selected robot. Updates `robot` and `robots` immediately
    // (optimistic) so every consumer — this component, the robots list, headers, etc. —
    // reflects the new name right away rather than waiting on a refetch. Rolls both back
    // if the request fails.
    const updateRobotName = async (name: string) => {
        if (!robot) return
        const serial = robot.serial
        const previousName = robot.name

        setRobot(cur => cur && cur.serial === serial ? { ...cur, name } : cur)
        setRobots(cur => {
            if (!cur || !cur[serial]) return cur
            return { ...cur, [serial]: { ...cur[serial], name } }
        })

        try {
            await Http.updateRobot(serial, { name })
        } catch (err) {
            console.error('Failed to update robot name', err)
            setRobot(cur => cur && cur.serial === serial ? { ...cur, name: previousName } : cur)
            setRobots(cur => {
                if (!cur || !cur[serial]) return cur
                return { ...cur, [serial]: { ...cur[serial], name: previousName } }
            })
        }
    }

    // fetch floorplans/persistent maps whenever the connected robot changes
    useEffect(() => {
        if (!robot) return;
        persistentMapsLoader.request(robot.serial).catch(err => console.error('Failed to fetch floorplans', err))
    }, [robot?.serial, robot?.type])

    // Robot list: one fetch for the first paint, then kept in sync by the
    // server's event stream (a `robots` event on every connect/disconnect/rename;
    // the stream also sends a snapshot each time it (re)opens, so no polling).
    useEffect(() => {
        // The initial GET and the SSE snapshot race; if a newer snapshot lands
        // first, don't let the slower GET overwrite it with stale data.
        let receivedEventSnapshot = false

        const events = new EventSource('/api/events')
        events.addEventListener('robots', (event) => {
            receivedEventSnapshot = true
            setRobots(JSON.parse((event as MessageEvent).data))
        })
        Http.getRobots().then((res) => {
            if (!receivedEventSnapshot) setRobots(res.data)
        }).catch(err => console.error('Failed to fetch robots', err))
        events.onerror = (err) => console.error('events stream error:', err)
        return () => events.close()
    }, [])

    // Nothing selected yet (first load, or all robots were offline): select the
    // first robot that is online. A selected robot that goes offline stays
    // selected, with its last known state, until it comes back.
    useEffect(() => {
        if (robot || !robots || connectingRef.current) return
        const firstOnline = Object.entries(robots).find(([, info]) => info.connected)
        if (!firstOnline) return
        connectingRef.current = true
        connectToRobot(firstOnline[0], firstOnline[1].type, firstOnline[1].name)
    }, [robots, robot])

    useEffect(() => {
        if (robot) connectingRef.current = false
    }, [robot?.serial])

    // If the selected robot drops and comes back, its /app/robot/{serial}/connect
    // stream stays open (serial/type unchanged), so neither that effect nor its
    // onopen refresh re-runs. Re-fetch the robot's state on an offline->online
    // transition so the UI leaves the stale offline snapshot behind.
    const prevConnRef = useRef<{ serial: string, connected: boolean } | undefined>(undefined)
    useEffect(() => {
        if (!robot) { prevConnRef.current = undefined; return }
        const isConnected = !!robots?.[robot.serial]?.connected
        const prev = prevConnRef.current
        prevConnRef.current = { serial: robot.serial, connected: isConnected }
        if (!prev || prev.serial !== robot.serial || prev.connected !== false || !isConnected) return

        if (robot.type === RobotType.NeatoGen3) {
            GEN3_COMMANDS.getRobotState(robot.serial).then((res) => {
                setRobot(cur => cur ? {
                    ...cur,
                    type: RobotType.NeatoGen3,
                    availableCommands: res.data.availableCommands,
                    details: res.data.details,
                    alert: res.data.alert,
                    error: res.data.error,
                    state: res.data.state,
                    action: res.data.action,
                } : cur)
            }).catch(err => console.error('Failed to refresh robot state', err))
        } else if (robot.type === RobotType.NeatoGen4) {
            GEN4_COMMANDS.getRobotState(robot.serial).then((res) => {
                const body = res.data.body
                setRobot(cur => cur?.type === RobotType.NeatoGen4 ? {
                    ...cur,
                    availableCommands: body.available_commands,
                    details: body.details,
                    errors: body.errors != null ? body.errors : undefined,
                    state: body.state,
                    action: body.action,
                } : cur)
            }).catch(err => console.error('Failed to refresh robot state', err))
        }
    }, [robots, robot?.serial, robot?.type])

    useEffect(() => {
        if (!robot) return;

        const events = new EventSource(
            `/api/robot/${robot.serial}/connect`,
        );

        events.onopen = () => {
            if (robot.type === RobotType.NeatoGen3) {
                GEN3_COMMANDS.getRobotState(robot.serial).then((res) => {
                    setRobot(cur => cur ? {
                        ...cur,
                        type: RobotType.NeatoGen3,
                        availableCommands: res.data.availableCommands,
                        details: res.data.details,
                        alert: res.data.alert,
                        error: res.data.error,
                        state: res.data.state,
                        action: res.data.action,
                    } : cur)
                });
            } else if (robot.type === RobotType.NeatoGen4) {
                GEN4_COMMANDS.getRobotState(robot.serial).then((res) => {
                    const body = res.data.body;
                    setRobot(cur => cur ? {
                        ...cur,
                        type: RobotType.NeatoGen4,
                        availableCommands: body.available_commands,
                        details: body.details,
                        errors: body.errors != null ? body.errors : undefined,
                        state: body.state,
                        action: body.action,
                    } : cur)
                })
            }
        }

        interface VacuulaRobotEvent {
            serial: string,
            ts: number,
            type: RobotType,
            data: AnyEvent
        }

        events.onmessage = (event) => {
            setLastHeartbeat(Date.now());
            const wrapper: VacuulaRobotEvent = JSON.parse(event.data);

            if (wrapper.type === RobotType.NeatoGen4) {
                type EventByService = {
                    [E in AnyEvent as E["to"]["service"]]: E
                };

                const handlers: {
                    [K in keyof EventByService]?: (body: EventByService[K]["body"]) => void
                } = {
                    [OrbitalServices.PEER_STATE]: (body) => {
                        setRobot(cur => cur?.type === RobotType.NeatoGen4 ? {
                            ...cur,
                            availableCommands: body.available_commands,
                            details: body.details,
                            errors: body.errors != null ? body.errors : undefined,
                            state: body.state,
                            action: body.action,
                        } : cur)
                    },
                    [OrbitalServices.ROBOTS_ERROR_CODES]: (body) => console.log('new errors', body),
                };

                const handler = handlers[wrapper.data.to.service];
                handler?.(wrapper.data.body as any); // !TODO any allowed in this case, maybe fix later
                return;
            }

            if (wrapper?.data?.type !== "state" && wrapper?.data?.eventId !== "77") {
                return;
            }

            setRobot(cur => cur ? {
                ...cur,
                availableCommands: wrapper.data.data.availableCommands,
                details: wrapper.data.data.details,
                alert: wrapper.data.data.alert,
                error: wrapper.data.data.error,
                state: wrapper.data.data.state,
                action: wrapper.data.data.action,
            } : cur)
        };

        events.onerror = (err) => {
            console.error("SSE error:", err);
        };

        return () => {
            events.close();
        };
    }, [robot?.serial, robot?.type]);

    const value: AppContextType = {
        userId,
        setUserId,
        isDarkMode,
        setIsDarkMode,
        isLoading,
        setIsLoading,
        loadingState,
        setLoadingState,
        message,
        setMessage,
        robot,
        robots,
        selectRobot,
        lastHeartbeat,

        // persistentMaps,
        // setPersistentMaps,
        cleanings,
        setCleanings,

        updateRobotName,
    }

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    )
}

export { AppContext }