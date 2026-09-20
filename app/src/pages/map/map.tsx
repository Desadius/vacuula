import { useRef, useEffect, useState, useCallback } from 'react'
import styles from './map.module.scss'
import Drawer from '../../components/drawer/drawer'

import { DRAWING } from './constants'
import type { NoGoLine, Zone, Point, SetZone, UseState } from './types'
import { FaPlus, FaTimes, FaUndo, FaPen, FaCheckCircle, FaCircle } from 'react-icons/fa'
import Input from '../../components/input/input'
import { PiBoundingBox } from "react-icons/pi";
import { biEnum } from '../../types/.helpers'
import Button from '../../components/button/button'
import { GEN3_COMMANDS } from '../../http/gen3'
import { CleaningMode, CleaningNavigationMode } from '../../types/neato/gen3/state'
import { Http } from '../../http'
import { Neato, RobotType, type Robot } from '../../types'

import MapCanvas, { type MapMode } from './MapCanvas'
import { drawZones, drawNoGoLines, drawInProgressPolyline, drawCrosshair, drawBase } from './drawingFunctions'
import { upsertPreserveOrder } from './utils'
import { GEN4_COMMANDS } from '../../http/gen4'
import { useRobot } from '../../context/useRobot'
import { usePersistentMaps } from '../../loaders/resources'
import type { Floorplan } from '../../types/neato/gen4'
import { v4 as uuidv4 } from 'uuid';
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'


export default () => {
    const { t } = useTranslation()
    const [boundaries, setBoundaries] = useState<(NoGoLine | Zone)[]>([])
    const [drawerOpen, setDrawerOpen] = useState(true)

    const [editForm, setEditForm] = useState({
        name: '',
        color: '',
        zoneType: BoundaryTypes.NOGO_LINE
    });

    const [mapEditform, setMapEditForm] = useState({
        name: '',
        enabled: true
    })

    const [currentLinePoints, setCurrentLinePoints] = useState<Point[]>([])
    const [closedAsPolygon, setClosedAsPolygon] = useState(false)
    const [persistentMap, setPersistentMap] = useState<string>()

    const [mode, setMode] = useState<MapMode>('maps')
    const [returnFromEditMode, SetReturnFromEditMode] = useState<'boundaries' | 'boundary-info'>('boundaries')
    const [activeBoundaryId, setActiveBoundaryId] = useState<string | undefined>(undefined);

    const { robot } = useRobot()
    // Auto-save bookkeeping. `serverBoundariesRef` holds the exact array object
    // last received from (or last confirmed by) the server; the save effect
    // POSTs only when `boundaries` is a DIFFERENT object, i.e. the change came
    // from the user. This replaces a single shared skip-flag whose outcome
    // depended on effect ordering: in some render orders it let a redundant
    // POST of freshly-loaded data go out, which could race an in-flight user
    // POST and, if processed out of order, overwrite the user's toggle.
    const serverBoundariesRef = useRef<(NoGoLine | Zone)[] | null>(null)

    const { data: persistentMaps, refresh: updatePersistentMaps } = usePersistentMaps()

    const extraDraw = useCallback((ctx, canvas, currentZoom, currentOffset, mapSize) => {
        const visibleBoundaries = boundaries.filter(b => !b.deleted)
        const showBoundaries = mode === 'boundary-edit'
            ? visibleBoundaries.filter(b => b.id !== activeBoundaryId)
            : visibleBoundaries

        drawZones(ctx, showBoundaries.filter(b => b.type === 'polygon'), currentZoom, currentOffset, mapSize)
        drawNoGoLines(ctx, showBoundaries.filter(b => b.type === 'polyline'), currentZoom, currentOffset, mapSize)

        const map = persistentMaps?.find(p => p.id === persistentMap)
        const basicdata = map?.base
        const NO_BASE = 2147483647
        if (basicdata && basicdata[0] !== NO_BASE && basicdata[1] !== NO_BASE) {
            const [originX, originY] = map.origin
            const resolution = map.resolution
            const [imgW, imgH] = map.imgsize
            const normX = ((basicdata[0] - originX) / resolution) / imgW
            const normY = ((basicdata[1] - originY) / resolution) / imgH
            drawBase(ctx, { x: normX, y: normY, width: 4 / imgW, height: 4 / imgH }, currentZoom, currentOffset, mapSize)
        }

        if (mode === 'boundary-edit') {
            drawCrosshair(ctx, canvas)
            if (closedAsPolygon) {
                drawZones(ctx, [{ vertices: currentLinePoints, name: '', color: editForm.color, function: 'cleaning', type: 'polygon', id: '', enabled: true }], currentZoom, currentOffset, mapSize)
            } else {
                drawInProgressPolyline(ctx, currentLinePoints, currentZoom, currentOffset, mapSize)
            }
        }
    }, [boundaries, activeBoundaryId, mode, currentLinePoints, closedAsPolygon, editForm.color, persistentMaps, persistentMap])

    // Fetch boundaries when persistentMap changes
    useEffect(() => {
        if (!persistentMap) return
        // Start the new map from a known-empty, server-owned array so the save
        // effect (which POSTs only when `boundaries` differs from the server
        // object) does not fire for this reset.
        const empty: (NoGoLine | Zone)[] = []
        serverBoundariesRef.current = empty
        setBoundaries(empty)
        const accept = (data: (NoGoLine | Zone)[]) => {
            // MERGE, never overwrite: anything in local state at this point is a
            // user edit made while the load was in flight (the list starts empty,
            // so it cannot be anything else). Server data is the base and each
            // local edit is upserted on top, so a late response can never wipe
            // an edit. If nothing was edited, local is [] and merged === data.
            setBoundaries(local => {
                const merged = local.reduce((acc, b) => upsertPreserveOrder(acc, b), data)
                // If no edits were merged, the result IS the server state; record
                // that so the save effect stays quiet. Otherwise leave the ref on
                // `data` so the merged result (which differs) gets POSTed.
                serverBoundariesRef.current = local.length === 0 ? merged : data
                return merged
            })
        }
        if (robot.type === RobotType.NeatoGen4) {
            Http.getBoundaries(robot.serial, persistentMap).then(res => accept(res.data))
        } else {
            GEN3_COMMANDS.getMapBoundaries(robot.serial, persistentMap).then(res => accept(res.data.data.boundaries))
        }
        setMode('boundaries')
    }, [persistentMap])

    const updatePersistentMap = (data: { name: string, enabled: boolean }, mapToChange?: string) => {
        const map = mapToChange || persistentMap;
        if (!map) return;
        Http.updatePersistentMap(robot.serial, map, data).finally(() => {
            updatePersistentMaps()
            if (persistentMap) setMode('boundaries')
        })
    }

    useEffect(() => {
        if (!robot) return;
        updatePersistentMaps();
    }, [robot])

    // Auto-save: every user edit (toggle, draw, rename, delete) lands in
    // `boundaries` as a new array object; we POST it immediately. Loads from the
    // server set `boundaries` to the very object stored in serverBoundariesRef,
    // so they are recognised by identity and never re-POSTed.
    useEffect(() => {
        if (!persistentMap) return;
        if (boundaries === serverBoundariesRef.current) return;   // server-originated, nothing to save
        const toSave = boundaries
        Http.postBoundaries(robot.serial, persistentMap, toSave).then(() => {
            // Only mark as confirmed if no further edit happened while the POST
            // was in flight; a newer edit will run its own save.
            setBoundaries(current => {
                if (current !== toSave) return current
                // Drop tombstoned items now the server has persisted the removal;
                // the pruned array becomes the confirmed server state.
                const pruned = toSave.some(b => b.deleted) ? toSave.filter(b => !b.deleted) : toSave
                serverBoundariesRef.current = pruned
                return pruned
            })
        }).catch(e => {
            console.error('failed to save map boundaries', e)
        });
    }, [boundaries]);

    // mode changes
    useEffect(() => {
        if (mode === 'boundaries') setActiveBoundaryId(undefined)
        if (mode === 'map-edit') {
            const pmap = persistentMaps?.find(p => p.id === persistentMap)
            if (!pmap) return;
            setMapEditForm({
                name: pmap.name,
                enabled: 'enabled' in pmap ? pmap.enabled : false // TODO: meh fix
            })
        }
        if (mode !== 'boundary-edit') {
            setCurrentLinePoints([])
            setClosedAsPolygon(false)
            return
        }
        const existingBoundary = boundaries.find(b => b.id === activeBoundaryId);
        setEditForm({
            name: existingBoundary?.name ?? '',
            color: existingBoundary?.color ?? `#${Math.floor(Math.random() * 16777215).toString(16)}`,
            zoneType: existingBoundary?.type === 'polygon' ?
                (existingBoundary?.function === 'cleaning' ?
                    BoundaryTypes.CLEANING_ZONE : BoundaryTypes.NOGO_ZONE
                ) : BoundaryTypes.NOGO_LINE
        });
        setCurrentLinePoints(existingBoundary?.vertices || [])
        setClosedAsPolygon(existingBoundary?.type === 'polygon')
    }, [mode])

    const saveEditBoundary = () => {
        setMode(returnFromEditMode);
        const id = activeBoundaryId ?? uuidv4();
        const updated = {
            id,
            name: editForm.name,
            color: editForm.color,
            function: closedAsPolygon ? (editForm.zoneType === BoundaryTypes.NOGO_ZONE ? 'nogo' : 'cleaning') : 'nogo',
            type: closedAsPolygon ? 'polygon' as const : 'polyline' as const,
            vertices: currentLinePoints,
            enabled: true
        };
        setBoundaries(prev => upsertPreserveOrder(prev, updated));
    };

    const updateForm = <T extends object>(update: UseState<T>, patch: Partial<T>) => {
        update(prev => ({ ...prev, ...patch }))
    }

    // Toggle a zone's or no-go line's `enabled` flag. This is PERSISTED (the
    // auto-save effect POSTs it) and is the floorplan's configuration:
    //  - zone enabled   = included in the map's default clean (home Map+Start)
    //  - no-go enabled  = its geometry is part of the map's one no-go union
    // Manual cleaning is started from the home screen (Map+Start), which reads
    // exactly these flags, so there is no separate per-run selection here.
    const toggleEnabled = (item: NoGoLine | Zone) => {
        setBoundaries(prev => upsertPreserveOrder(prev, { ...item, enabled: !item.enabled }));
    };

    const deleteBoundary = (id: string) => {
        // Tombstone the boundary so the next postBoundaries carries an explicit
        // delete signal (server uses merge/upsert and won't remove absent rows).
        // The post effect prunes deleted items from state after a successful POST.
        setBoundaries(prev => prev.map(b => b.id === id ? { ...b, deleted: true } : b));
        setMode('boundaries')
    };

    const openInfo = (id: string) => {
        setMode('boundary-info')
        setActiveBoundaryId(id)
    }

    const openEdit = (id: string) => {
        if (mode !== 'boundaries' && mode !== 'boundary-info') return;
        SetReturnFromEditMode(mode)
        setMode('boundary-edit')
        setActiveBoundaryId(id)
    }

    const handleBackBtn = () => {
        if (mode === 'boundaries') {
            setPersistentMap(undefined);
            setMode('maps')
        } else if (mode === 'map-edit' || mode === 'boundary-info') {
            setMode('boundaries')
        }
    }

    const getTitle = () => {
        switch (mode) {
            case 'maps': return t('map.maps')
            case 'boundaries':
            case 'map-edit':
                return t('map.mapTitle', { name: persistentMaps?.find(p => p.id === persistentMap)?.name ?? '' })
            case 'boundary-info': return ' '
            case 'boundary-edit':
                if (!drawerOpen) return t('map.dragUpToFinish')
                return t('map.editBoundary')
        }
    }

    return (
        <div className={styles.container}>
            {persistentMap ? (
                <MapCanvas
                    mapId={persistentMap}
                    mode={mode}
                    extraDraw={extraDraw}
                    redrawKey={extraDraw}
                    currentLinePoints={currentLinePoints}
                    setCurrentLinePoints={setCurrentLinePoints}
                    closedAsPolygon={closedAsPolygon}
                    setClosedAsPolygon={setClosedAsPolygon}
                    setDrawerOpen={setDrawerOpen}
                />
            ) : (
                <canvas className={styles.canvas} />
            )}

            {mode === 'maps' && (
                <div className={styles.selectMap}>
                    <span>{t('map.selectMap')}</span>
                </div>
            )}

            <Drawer
                open={drawerOpen}
                handle={true}
                showBackButton={['map-edit', 'boundaries', 'boundary-info'].includes(mode)}
                onBackButtonClick={handleBackBtn}
                onOpenChange={setDrawerOpen}
                openHeightPercent={mode === 'boundary-edit' ? 60 : mode === 'boundary-info' ? 30 : 70}
                title={getTitle()}
            >
                {mode === 'maps' && (
                    <div className={styles.featureList}>
                        {persistentMaps?.map((item, i) => (
                            <div key={i} className={styles.item} onClick={() => setPersistentMap(item.id)}>
                                <div className={styles.info}>
                                    <span>{item.name}</span>
                                    <span className={styles.type}>{new Date(robot.type === RobotType.NeatoGen4 ? item.created_at : item.id).toLocaleString(i18n.language)}</span>
                                </div>
                                {'enabled' in item ? (
                                    <Input type="switch" skipSection={true} value={item.enabled} onChange={() => {
                                        updatePersistentMap({ name: item.name, enabled: !item.enabled }, item.id);
                                    }} />
                                ) : (
                                    <PromoteDemoteBtn robot={robot} map={item} onSuccess={updatePersistentMaps} />
                                )}
                            </div>
                        ))}
                        {persistentMaps?.length === 0 && (
                            <span style={{ textAlign: 'center' }}>{t('map.noMaps')}</span>
                        )}
                        <hr style={{ width: '90%' }} />
                        <div className={styles.item} style={{ justifyContent: 'center', textAlign: 'center', background: 'var(--accent-soft)' }} onClick={() => robot.type === RobotType.NeatoGen4
                            ? GEN4_COMMANDS.startCleaning(robot.serial, Neato.Gen4.CleaningMode.ECO, Neato.Gen4.CleaningNavigationMode.GENTLE)
                            : GEN3_COMMANDS.startPersistentMapExploration(robot.serial)}>
                            <div className={styles.info}>
                                <span>{t('map.newMap')}</span>
                                <span className={styles.type}>{t('map.exploreNewMap')}</span>
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'map-edit' && mapEditform && persistentMap && (
                    <div>
                        <Input
                            type="text"
                            label={t('common.name')}
                            value={mapEditform.name}
                            onChange={(name) => updateForm(setMapEditForm, { name })} />
                        {robot.type === RobotType.NeatoGen3 && (
                            <Input type="switch" label={t('common.enabled')} value={mapEditform.enabled} onChange={(enabled) => updateForm(setMapEditForm, { enabled })} />
                        )}
                        <Button text={t('common.save')} style='success' onClick={() => {
                            updatePersistentMap(mapEditform);
                        }} />
                        {robot.type === RobotType.NeatoGen4 &&
                            (persistentMaps?.find(p => p.id === persistentMap) as Floorplan)?.in_maps_list &&
                            !(persistentMaps?.find(p => p.id === persistentMap) as Floorplan)?.promoted && (
                                <div style={{ padding: '1rem 0' }}>
                                    <Button text={t('map.stopUsingAsFloormap')} style='fail' onClick={() =>
                                        Http.postUnuseMapAsFloorPlan(robot.serial, persistentMap).then(() => {
                                            setMode('maps')
                                            updatePersistentMaps()
                                        })} />
                                </div>
                            )}
                    </div>
                )}

                {mode === 'boundary-edit' && (
                    <EditBoundaryDetails
                        currentLinePoints={currentLinePoints}
                        closedAsPolygon={closedAsPolygon}
                        setDrawerOpen={setDrawerOpen}
                        save={saveEditBoundary}
                        name={editForm.name}
                        color={editForm.color}
                        zoneType={editForm.zoneType}
                        setName={(name) => updateForm(setEditForm, { name })}
                        setColor={(color) => updateForm(setEditForm, { color })}
                        setZoneType={(zoneType) => updateForm(setEditForm, { zoneType })}
                        cancel={() => {
                            setMode(returnFromEditMode)
                        }}
                        supportsZoneType={robot.type === RobotType.NeatoGen4}
                    />
                )}

                {mode === 'boundary-info' && activeBoundaryId && (
                    <BoundaryDetails
                        boundary={boundaries.find(b => b.id === activeBoundaryId)!}
                        deleteBoundary={deleteBoundary}
                        editBoundary={() => {
                            setMode('boundary-edit');
                            SetReturnFromEditMode(mode)
                        }}
                        onCleanZone={(zone) => GEN3_COMMANDS.startCleaningZone(robot.serial, zone.id, CleaningMode.ECO, CleaningNavigationMode.EXTRA_CARE)}
                        isGen4={robot.type === RobotType.NeatoGen4}
                    />
                )}

                {mode === 'boundaries' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                            {robot.type === RobotType.NeatoGen4 ? (
                                <PromoteDemoteBtn robot={robot} map={persistentMaps?.find(p => p.id === persistentMap) as Floorplan} onSuccess={updatePersistentMaps} />
                            ) : (
                                <span>{(persistentMaps?.find(p => p.id === persistentMap) as Neato.Gen3.PersistentMap)?.enabled ? t('common.enabled') : t('common.disabled')}</span>
                            )}

                            <Button text={t('map.editMapDetails')} style='primary' onClick={() => setMode('map-edit')} />
                        </div>
                        <hr />
                        <div className={styles.buttonContainer}>
                            <Button text={t('map.addFeature')} style='primary' onClick={() => openEdit(uuidv4())} />
                        </div>

                        <div className={styles.featureList}>
                            {boundaries.filter(b => !b.deleted).map((item, i) => (
                                <div key={i} className={styles.item} style={{ background: `${item.color || 'red'}22` }} onClick={() => openInfo(item.id)}>
                                    <div className={styles.info}>
                                        <span>{item.name}</span>
                                        <span className={styles.type} style={{ color: item.color }}>
                                            {item.type === 'polygon' ? t('map.zone') : t('map.noGoLine')}
                                        </span>
                                    </div>
                                    {/* Persisted `enabled` toggle for every zone and no-go line (auto-saved).
                                        Zone: included in the map's default clean. No-go: part of the no-go union. */}
                                    {(item.type === 'polyline' || (item as Zone).function === 'nogo' || (robot.type === RobotType.NeatoGen4 && (item as Zone).function === 'cleaning')) && (
                                        <div onClick={(e) => e.stopPropagation()}><Input type="switch" skipSection={true} value={item.enabled} onChange={() => toggleEnabled(item)} /></div>
                                    )}
                                    {robot.type === RobotType.NeatoGen3 && item.type === 'polygon' && (<div onClick={(e) => e.stopPropagation()}><Button style='primary' text={t('map.cleanZone', 'Clean zone')} onClick={() => GEN3_COMMANDS.startCleaningZone(robot.serial, item.id, CleaningMode.ECO, CleaningNavigationMode.EXTRA_CARE)} /></div>)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Drawer>
        </div>
    )
}

interface BoundaryDetailsProps {
    boundary: NoGoLine | Zone
    editBoundary: (id: string) => void
    deleteBoundary: (id: string) => void
    onCleanZone: (boundary: Zone) => void
    isGen4: boolean
}

const BoundaryDetails = (props: BoundaryDetailsProps) => {
    const { t } = useTranslation()
    return (
        <div className={styles.boundaryDetails}>
            <div className={styles.featureList}>
                <div className={styles.item} style={{ background: `${props.boundary.color || 'red'}22` }}>
                    <div className={styles.info}>
                        <span>{props.boundary.name}</span>
                        <span className={styles.type} style={{ color: props.boundary.color }}>{props.boundary.type === 'polygon' ? t('map.zone') : t('map.noGoLine')}</span>
                    </div>
                    {props.boundary.type === 'polyline' && (<Input type="switch" skipSection={true} value={props.boundary.enabled} onChange={(value) => props.boundary.enabled = value} />)}
                </div>
            </div>

            <div className={styles.zoneActions}>
                {props.boundary.type === 'polygon' && !props.isGen4 && (
                    <Button text={t('map.cleanZone', 'Clean zone')} style='primary' onClick={() => props.onCleanZone(props.boundary as Zone)} />
                )}
                <Button text={t('common.edit')} style='primary' onClick={() => props.editBoundary(props.boundary.id)} />
                <Button text={t('common.delete')} style='fail' onClick={() => props.deleteBoundary(props.boundary.id)} />
            </div>
        </div>
    )
}


enum BoundaryTypes {
    NOGO_LINE = 'nogo-line',
    NOGO_ZONE = 'nogo-zone',
    CLEANING_ZONE = 'cleaning-zone',
}

interface EditBoundaryDetailsProps {
    currentLinePoints: Point[]
    closedAsPolygon: boolean
    name: string,
    setName: (name: string) => void;
    color: string,
    setColor: (color: string) => void;
    zoneType: BoundaryTypes;
    setZoneType: (zoneType: BoundaryTypes) => void;
    save: () => void
    cancel: () => void
    setDrawerOpen: (open: boolean) => void;
    supportsZoneType: boolean
}

const EditBoundaryDetails = (props: EditBoundaryDetailsProps) => {
    const { t } = useTranslation()
    return (
        <div className={styles.editBoundaryDetails}>

            <div>
                <Input
                    type="text"
                    label={t('common.name')}
                    value={props.name}
                    onChange={(value) => props.setName(value)} />

                {props.currentLinePoints.length > 1 ? (
                    <Input
                        type="select"
                        label={props.supportsZoneType && props.closedAsPolygon ? t('map.zoneType') : t('common.type')}
                        options={[
                            {
                                value: props.closedAsPolygon ? BoundaryTypes.CLEANING_ZONE : BoundaryTypes.NOGO_LINE,
                                label: props.closedAsPolygon ? (props.supportsZoneType ? t('map.cleaning') : t('map.zone')) : t('map.noGoLine')
                            },
                            ...((props.supportsZoneType && props.closedAsPolygon) ? [{ value: BoundaryTypes.NOGO_ZONE, label: t('map.noGo') }] : [])
                        ]}
                        value={props.closedAsPolygon ? (props.supportsZoneType ? props.zoneType : BoundaryTypes.CLEANING_ZONE) : BoundaryTypes.NOGO_LINE}
                        onChange={(zoneType) => {
                            if (!props.supportsZoneType) return;
                            props.setZoneType(zoneType)
                        }}
                        extraInfo={
                            props.closedAsPolygon ?
                                t('map.polygonHint') :
                                t('map.lineHint')
                        }
                    />
                ) : (
                    <Input
                        type="custom"
                        label={t('common.type')}
                        extraInfo={t('map.drawHint')}>
                        <Button text={t('map.drawBoundary')} style='primary' onClick={() => props.setDrawerOpen(false)} />
                    </Input>
                )}

                <Input
                    type="text"
                    label={t('map.color')}
                    value={props.color}
                    onChange={(value) => props.setColor(value)}
                />
            </div>


            <div className={styles.editBoundaryActionButtons}>
                <Button text={t('common.cancel')} style='fail' onClick={() => props.cancel()} />
                <Button text={t('common.save')} style='success' onClick={() => props.save()} />
            </div>
        </div>
    )
}

interface PromoteDemoteBtnProps {
    robot: Robot,
    map: Floorplan
    onSuccess: () => void
}
const PromoteDemoteBtn = ({ robot, map, onSuccess }: PromoteDemoteBtnProps) => {
    const { t } = useTranslation()
    return <Button text={map.promoted ? t('map.demote') : t('map.promote')} onClick={() => {
        if (map.promoted) Http.demoteFloorplan(robot.serial, map.id).finally(() => onSuccess())
        else Http.test(robot.serial, map.id).finally(() => onSuccess());
    }} style={map.promoted ? 'fail' : 'success'} />
}
