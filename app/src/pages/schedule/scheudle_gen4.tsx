import { useRef, useEffect, useState, useCallback } from 'react'
import styles from './schedule.module.scss'
import Drawer from '../../components/drawer/drawer'

import type { GetSchedule, ScheduleEvent } from './types'
import { FaPlus, FaTimes, FaUndo, FaPen, FaCheckCircle, FaCircle, FaTrash } from 'react-icons/fa'
import Input from '../../components/input/input'
import { PiBoundingBox } from "react-icons/pi";
import { biEnum } from '../../types/.helpers'
import Button from '../../components/button/button'
import { CleaningMode, CleaningNavigationMode } from '../../types/neato/gen3/state'
import { Http } from '../../http'
import { useApp } from '../../context/useApp'
import { RobotDay } from '../../types/neato/gen3/api'
import type { UseState, Zone, NoGoLine } from '../map/types'
import { GEN4_COMMANDS } from '../../http/gen4'
import { Neato } from '../../types'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { dayKey } from '../../i18n/days'

function getDayText(days: Neato.Gen4.Days[], t: TFunction) {
    const set = new Set(days);
    if (set.size === 7) return t('schedule.everyday')
    if (set.size === 2 && set.has(Neato.Gen4.Days.SATURDAY) && set.has(Neato.Gen4.Days.SUNDAY)) return t('schedule.weekends')
    if (set.size === 5 && !set.has(Neato.Gen4.Days.SATURDAY) && !set.has(Neato.Gen4.Days.SUNDAY)) return t('schedule.weekdays')
    return days.map(d => t(`days.${dayKey(d)}`)).join(', ')
}

export default () => {
    const { t } = useTranslation()
    const [schedule, setSchedule] = useState<Neato.Gen4.ScheduledCommands>()
    const [drawerOpen, setDrawerOpen] = useState(false)

    const [scheduleFormNavigationMode, setScheduleFormNavigationMode] = useState<Neato.Gen4.CleaningNavigationMode>()
    const [scheduleFormCleaningMode, setScheduleCleaningMode] = useState<Neato.Gen4.CleaningMode>()

    const [scheduleForm, setScheduleForm] = useState<Omit<Neato.Gen4.CommandEvent, "command">>({
        enabled: true,
        days: [],
        time: '',
    })

    const { robot, promotedFloorplan } = useApp()

    // The schedule targets the currently promoted map (derived in AppContext): its
    // zones/no-go are what the user picks from, and its rank_id is what each run references.
    const promotedMap = promotedFloorplan

    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])
    const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set())
    // Per-event no-go apply flag. The floorplan has ONE no-go union (firmware limit),
    // so a schedule can only say "apply the map's no-go set" or "ignore it" - not pick
    // a per-event subset. This mirrors the event's stored runs[].map.nogo_enabled and
    // is what the run is saved with; it never mutates the map's shared boundaries.
    const [nogoEnabled, setNogoEnabled] = useState<boolean>(true)

    // ALL zones of the floorplan are selectable: the server uploads every zone's
    // track on promote (regardless of `enabled`), so each schedule event can pick
    // any subset independently of the map's default (home Map+Start) selection.
    const cleaningZones = boundaries.filter(b => (b as Zone).function === 'cleaning' && !b.deleted)
    const noGoLines = boundaries.filter(b => b.type === 'polyline' || (b as Zone).function === 'nogo')

    const setFormFromEvent = (event: Neato.Gen4.CommandEvent) => {
        const zoneIds = event.command.runs.map(r => r.map?.track_id).filter(Boolean) as string[]
        setSelectedZones(new Set(zoneIds));
        setNogoEnabled(event.command.runs[0]?.map?.nogo_enabled ?? true);
        setScheduleForm(event);
        setScheduleFormNavigationMode(event.command.runs[0].settings.navigation_mode);
        setScheduleCleaningMode(event.command.runs[0].settings.mode);
        setDrawerOpen(true)
    }

    const openCleanForm = () => {
        setSelectedZones(new Set());
        setNogoEnabled(true);
        setScheduleForm({
            enabled: true,
            days: [],
            time: ''
        });
        setScheduleFormNavigationMode(undefined);
        setScheduleCleaningMode(undefined);
        setDrawerOpen(true)
    }

    const getSchedule = () => {
        GEN4_COMMANDS.getSchedule(robot.serial).then(res => {
            setSchedule(res.data.body)
        })
    }

    useEffect(() => {
        if (!robot) return;
        getSchedule();
    }, [robot])

    // Load the promoted map's boundaries so the user can pick zones / toggle no-go.
    useEffect(() => {
        if (!robot || !promotedMap) { setBoundaries([]); return }
        Http.getBoundaries(robot.serial, promotedMap.id).then(res => setBoundaries(res.data))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [robot, promotedMap?.id])

    const toggleZoneSelect = (id: string) => {
        setSelectedZones(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            return next
        })
    }

    const targetText = (event: Neato.Gen4.CommandEvent) => {
        const ids = event.command.runs.map(r => r.map?.track_id).filter(Boolean) as string[]
        if (ids.length === 0) return t('schedule.wholeMap', 'Whole map')
        const names = ids.map(id => boundaries.find(b => b.id === id)?.name).filter(Boolean)
        return names.length ? names.join(', ') : `${ids.length} ${t('map.zone', 'zone')}`
    }

    const removeEvent = (id: string) => {
        if (!schedule) return;
        setDrawerOpen(false);
        GEN4_COMMANDS.deleteScheduledEvent(robot.serial, id).finally(() => getSchedule())
    }

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({
            ...prev,
            ...patch
        }))
    }

    if (!schedule) return

    return (
        <div className={styles.container}>

            <div className={styles.featureList}>
                <div className={styles.item} style={{ justifyContent: 'center', textAlign: 'center', background: 'var(--accent-soft)' }} onClick={() => openCleanForm()}>
                    <div className={styles.info}>
                        <span>{t('schedule.newSchedule')}</span>
                        <span className={styles.type}>{t('schedule.addOneMore')}</span>
                    </div>
                </div>

                {schedule.events?.map((item, i) => (
                    <div key={i} className={styles.item} onClick={() => setFormFromEvent(item)}>
                        <div className={styles.info}>
                            <span>{item.time} - {targetText(item)}</span>
                            <span className={styles.type}>{t('schedule.gen4Summary', { when: getDayText(item.days, t), mode: item.command.runs[0].settings.mode, navigation: item.command.runs[0].settings.navigation_mode })}</span>
                        </div>
                        <Input type="switch" skipSection={true} value={item.enabled} onChange={() => {
                            item.enabled = !item.enabled;
                            GEN4_COMMANDS.updateOrAddSchduledEvent(robot.serial, item).then(() => getSchedule())
                        }} />
                    </div>
                ))}
                {schedule.events?.length === 0 && (
                    <span style={{ textAlign: 'center' }}>{t('schedule.noSchedules')}</span>
                )}
            </div>
            <Drawer
                open={drawerOpen}
                handle={false}
                onOpenChange={setDrawerOpen}
                openHeightPercent={70}
                title={t('schedule.addEvent')}
            >

                <div>
                    <Input
                        type="multi-select"
                        label={t('common.day')}
                        options={[
                            { value: Neato.Gen4.Days.MONDAY, label: t('days.monday') },
                            { value: Neato.Gen4.Days.TUESDAY, label: t('days.tuesday') },
                            { value: Neato.Gen4.Days.WEDNESDAY, label: t('days.wednesday') },
                            { value: Neato.Gen4.Days.THURSDAY, label: t('days.thursday') },
                            { value: Neato.Gen4.Days.FRIDAY, label: t('days.friday') },
                            { value: Neato.Gen4.Days.SATURDAY, label: t('days.saturday') },
                            { value: Neato.Gen4.Days.SUNDAY, label: t('days.sunday') },
                        ]}
                        value={scheduleForm.days}
                        onChange={(days) => updateForm(setScheduleForm, { days })}
                    />

                    <Input
                        type="select"
                        label={t('common.mode')}
                        options={[
                            { value: Neato.Gen4.CleaningMode.AUTO, label: t('modes.auto') },
                            { value: Neato.Gen4.CleaningMode.ECO, label: t('modes.eco') },
                            { value: Neato.Gen4.CleaningMode.MAX, label: t('modes.max') },
                            { value: Neato.Gen4.CleaningMode.TURBO, label: t('modes.turbo') },
                        ]}
                        value={scheduleFormCleaningMode}
                        onChange={(mode) => setScheduleCleaningMode(mode)}
                    />

                    <Input
                        type="select"
                        label={t('schedule.navigation')}
                        options={[
                            { value: Neato.Gen4.CleaningNavigationMode.NORMAL, label: t('modes.normal') },
                            { value: Neato.Gen4.CleaningNavigationMode.GENTLE, label: t('modes.gentle') },
                        ]}
                        value={scheduleFormNavigationMode}
                        onChange={(mode) => setScheduleFormNavigationMode(mode)}
                    />

                    <Input
                        type="text"
                        label={t('common.time')}
                        value={scheduleForm.time}
                        onChange={(time) => updateForm(setScheduleForm, { time })} />

                    {promotedMap && cleaningZones.length > 0 && (
                        <div>
                            <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 4 }}>{t('schedule.zonesToClean', 'Zones to clean (none = whole map)')}</div>
                            {cleaningZones.map(z => (
                                <div key={z.id} className={styles.item}>
                                    <div className={styles.info}><span>{z.name}</span></div>
                                    <Input type="switch" skipSection={true} value={selectedZones.has(z.id)} onChange={() => toggleZoneSelect(z.id)} />
                                </div>
                            ))}
                        </div>
                    )}

                    {promotedMap && noGoLines.length > 0 && (
                        <div className={styles.item}>
                            <div className={styles.info}><span>{t('schedule.noGoLines', 'No-go lines')}</span></div>
                            <Input type="switch" skipSection={true} value={nogoEnabled} onChange={() => setNogoEnabled(v => !v)} />
                        </div>
                    )}

                    <Button text={t('common.save')} style='success' onClick={async () => {
                        if (!scheduleFormNavigationMode || !scheduleFormCleaningMode) return;

                        const settings = {
                            navigation_mode: scheduleFormNavigationMode,
                            mode: scheduleFormCleaningMode,
                        }

                        // Same apply as the map menu: promote the map so the robot holds the
                        // zone/no-go tracks the (autonomously-fired) schedule will reference.
                        // Http.test resolves only after the robot has ACKNOWLEDGED the promote
                        // (the server blocks on the robot's reply), so the tracks are committed
                        // before we save a schedule that references them. Abort on failure: a
                        // schedule pointing at un-uploaded tracks would silently misfire.
                        if (promotedMap) {
                            try {
                                await Http.test(robot.serial, promotedMap.id)
                            } catch (e) {
                                console.error('apply zones/no-go before saving schedule failed; aborting save', e)
                                return
                            }
                        }

                        const rankId = promotedMap ? promotedMap.id : (null as any)
                        const zoneIds = promotedMap ? cleaningZones.filter(z => selectedZones.has(z.id)).map(z => z.id) : []

                        const runs: Neato.Gen4.SchduleRun[] = zoneIds.length > 0
                            ? zoneIds.map(track_id => ({ settings, map: { rank_id: rankId, track_id, nogo_enabled: nogoEnabled } }))
                            : [{ settings, map: { rank_id: rankId, track_id: null, nogo_enabled: nogoEnabled } }]

                        GEN4_COMMANDS.updateOrAddSchduledEvent(robot.serial, {
                            ...scheduleForm,
                            command: {
                                ability: "cleaning.start",
                                auto_localization: false, // unused
                                force_floorplan: false,
                                runs,
                            }
                        }).finally(() => getSchedule())
                    }} />

                    {scheduleForm.id && (
                        <Button text={t('common.delete')} style='fail' onClick={() => removeEvent(scheduleForm.id!)} />
                    )}
                </div>

            </Drawer>

        </div>
    )
}
