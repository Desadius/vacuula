import styles from './home.module.scss'
import { useMascot } from '../../mascot'
import { MdAutoAwesome, MdCleaningServices, MdError, MdOutlineHealthAndSafety, MdWarning } from 'react-icons/md'
import { IoMdPause, IoMdPlay } from 'react-icons/io'
import { TbAdjustments, TbLeaf, TbHome } from 'react-icons/tb'
import { FaBell, FaFan, FaStop } from 'react-icons/fa'
import { HiMap } from "react-icons/hi2";
import { CleaningCategory, CleaningMode, CleaningNavigationMode, RobotAction, RobotState } from '../../types/neato/gen3/state'
import { useEffect, useState } from 'react'
import Drawer from '../../components/drawer/drawer'
import { FaHouse } from 'react-icons/fa6'
import { BiTargetLock } from "react-icons/bi";
import { useApp } from '../../context/useApp'
import TimeAgo from 'react-timeago'
import { GEN3_COMMANDS } from '../../http/gen3'
import Input from '../../components/input/input'
import { Neato, RobotType, type Gen4Robot, type Robot } from '../../types'
import { GEN4_COMMANDS } from '../../http/gen4'
import { Http } from '../../http'
import { useRobot } from '../../context/useRobot'
import { getRobotStateKey } from '../../utils/state'
import { useTranslation } from 'react-i18next'
import { useTimeAgoFormatter } from '../../i18n/timeago'
import { useUnits } from '../../units'


// ── Alert card ────────────────────────────────────────────────────────────────
function AlertCard({ type = 'error', icon, title, sub, action, onClick, visible = true }: { type?: 'error' | 'warning', icon: React.ReactNode, title: string, sub?: string, action?: string, onClick?: () => void, visible?: boolean }) {
    return (
        <div className={`${styles.alertCard} ${styles[type]}`} style={{ visibility: visible ? 'visible' : 'hidden' }}>
            <div className={styles.alertIconWrap}>
                {icon}
            </div>
            <div className={styles.alertText}>
                <div className={styles.alertTitle}>{title}</div>
                {sub && <div className={styles.alertSub}>{sub}</div>}
            </div>
            {action && <button className={styles.alertAction} onClick={onClick}>{action}</button>}
        </div>
    )
}

function Gen4AlertCards({ errors }: { errors: Neato.Gen4.Error[] }) {
    const { t } = useTranslation()
    return (
        <>
            {errors.map((error, i) =>
                <AlertCard
                    key={i}
                    visible={true}
                    type={error.severity}
                    icon={<MdError size={17} />}
                    title={t('home.errorTitle')}
                    sub={error.code}
                />
            )}
        </>
    )
}

// ── Control button ────────────────────────────────────────────────────────────
function CtrlBtn({ icon, label, disabled, onClick }: { icon: React.ReactNode, label: string, disabled?: boolean, onClick?: () => void }) {
    return (
        <button className={`${styles.ctrlBtn} ${disabled ? styles.disabled : ''}`} onClick={onClick} aria-label={label} disabled={disabled}>
            {icon}
            <span className={styles.ctrlLabel}>{label}</span>
        </button>
    )
}

var interval: number | undefined;

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Home() {
    const { t } = useTranslation()
    const timeAgoFormatter = useTimeAgoFormatter()
    const { formatLength } = useUnits()
    const { mascot } = useMascot()
    const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false)

    const [gen3__cleaningMode, gen3__setCleaningMode] = useState<CleaningMode>(CleaningMode.ECO)
    const [gen3__navigationMode, gen3__setNavigationMode] = useState<CleaningNavigationMode>(CleaningNavigationMode.NORMAL)
    const [gen3__cleaningCategory, gen3__setCleaningCategory] = useState<CleaningCategory>(CleaningCategory.HOUSE)

    const [gen4__cleaningMode, gen4__setCleaningMode] = useState<Neato.Gen4.CleaningMode>(Neato.Gen4.CleaningMode.ECO)
    const [gen4__navigationMode, gen4__setNavigationMode] = useState<Neato.Gen4.CleaningNavigationMode>(Neato.Gen4.CleaningNavigationMode.NORMAL)

    const [spotHeight, setSpotHeight] = useState(200)
    const [spotWidth, setSpotWidth] = useState(200)
    const [bellAnimating, setBellAnimating] = useState(false)
    const { lastHeartbeat, promotedFloorplan } = useApp()
    const { robot } = useRobot();

    return (
        <div className={styles.home}>

            {/* ── Alerts ── */}
            <div className={styles.alerts}>
                {robot.type === RobotType.NeatoGen4 && robot.errors && <Gen4AlertCards errors={robot.errors} />}

                {/* <AlertCard
                    visible={!!robot.error}
                    type="error"
                    icon={<MdError size={17} />}
                    title="error"
                    sub={robot.error}
                />
                <AlertCard
                    visible={!!robot.alert}
                    type="warning"
                    icon={<MdWarning size={17} />}
                    title="alert"
                    sub={robot.alert}
                    action="Dismiss"
                    onClick={() => {
                        GEN3_COMMANDS.dismissCurrentAlert(robot.serial)
                    }}
                /> */}
            </div>

            {/* ── Mascot + ring ── */}
            <div className={styles.mascotZone}>
                <div className={styles.statusRing}>
                    {/* <RingProgress pct={75} /> */}
                    <img src={mascot.src} alt={t('home.logoAlt')} className={styles.robotImage} />
                </div>
                <div className={styles.statusBadge}>
                    {/* <span className={styles.pulseDot} /> */}
                    <span className={styles.statusLabel}>
                        {t(getRobotStateKey(robot))}
                    </span>
                    <hr />
                    <span className={styles.timeAgo}>
                        {lastHeartbeat ? <TimeAgo date={lastHeartbeat} formatter={timeAgoFormatter} /> : t('common.notAvailable')}
                    </span>
                    {/* <span className={styles.statusLabel}>Offline</span> */}
                </div>
            </div>

            {/* ── Stats ── */}
            {/* <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>48<span className={styles.statUnit}>m²</span></div>
                    <div className={styles.statLabel}>Last coverage</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>15<span className={styles.statUnit}>min</span></div>
                    <div className={styles.statLabel}>Last run time</div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statValue}>23<span className={styles.statUnit}>min</span></div>
                    <div className={styles.statLabel}>Avg. run time</div>
                </div>
            </div> */}

            {/* ── Controls ── */}
            <div className={styles.buttons}>
                <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem' }}>
                    <CtrlBtn
                        icon={<FaBell size={22} className={bellAnimating ? styles.bellIcon : ''} />}
                        label={t('home.locate')}
                        onClick={() => {
                            setBellAnimating(true);
                            (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).findMe(robot.serial);
                            // Reset animation after it completes
                            setTimeout(() => setBellAnimating(false), 500)
                        }}
                    />

                    <CtrlBtn icon={
                        gen3__cleaningCategory === CleaningCategory.HOUSE ? <FaHouse size={22} /> :
                            gen3__cleaningCategory === CleaningCategory.SPOT ? <BiTargetLock size={22} /> :
                                gen3__cleaningCategory === CleaningCategory.MAP ? <HiMap size={22} /> : <TbAdjustments size={22} />
                    } onClick={() => setCategoryDrawerOpen(true)} label={
                        gen3__cleaningCategory === CleaningCategory.HOUSE ? t('home.house') :
                            gen3__cleaningCategory === CleaningCategory.SPOT ? t('home.spot') :
                                gen3__cleaningCategory === CleaningCategory.MAP ? t('home.map') : '...'
                    } />


                    {robot.type === RobotType.NeatoGen3 && (
                        <>

                            {gen3__navigationMode === CleaningNavigationMode.NORMAL && (<CtrlBtn icon={<MdCleaningServices color='var(--accent)' size={22} />} onClick={() => gen3__setNavigationMode(CleaningNavigationMode.EXTRA_CARE)} label={t('modes.normal')} />)}
                            {gen3__navigationMode === CleaningNavigationMode.EXTRA_CARE && (<CtrlBtn icon={<MdOutlineHealthAndSafety color='var(--warn)' size={22} />} onClick={() => gen3__setNavigationMode(CleaningNavigationMode.DEEP)} label={t('modes.extraCare')} />)}
                            {gen3__navigationMode === CleaningNavigationMode.DEEP && (<CtrlBtn icon={<MdAutoAwesome color='var(--violet)' size={22} />} onClick={() => gen3__setNavigationMode(CleaningNavigationMode.NORMAL)} label={t('modes.deep')} />)}

                            {gen3__cleaningMode === CleaningMode.ECO && (<CtrlBtn icon={<TbLeaf size={22} color='lime' />} onClick={() => gen3__setCleaningMode(CleaningMode.NORMAL)} label={t('modes.eco')} />)}
                            {gen3__cleaningMode === CleaningMode.NORMAL && (<CtrlBtn icon={<FaFan size={22} color='orange' />} onClick={() => gen3__setCleaningMode(CleaningMode.ECO)} label={t('modes.normal')} />)}
                        </>
                    )}

                    {robot.type === RobotType.NeatoGen4 && (
                        <>
                            {gen4__navigationMode === Neato.Gen4.CleaningNavigationMode.NORMAL && (<CtrlBtn icon={<MdCleaningServices color='var(--accent)' size={22} />} onClick={() => gen4__setNavigationMode(Neato.Gen4.CleaningNavigationMode.GENTLE)} label={t('modes.normal')} />)}
                            {gen4__navigationMode === Neato.Gen4.CleaningNavigationMode.GENTLE && (<CtrlBtn icon={<MdOutlineHealthAndSafety color='var(--warn)' size={22} />} onClick={() => gen4__setNavigationMode(Neato.Gen4.CleaningNavigationMode.NORMAL)} label={t('modes.gentle')} />)}

                            {gen4__cleaningMode === Neato.Gen4.CleaningMode.ECO && (<CtrlBtn icon={<TbLeaf size={22} color='lime' />} onClick={() => gen4__setCleaningMode(Neato.Gen4.CleaningMode.MAX)} label={t('modes.eco')} />)}
                            {gen4__cleaningMode === Neato.Gen4.CleaningMode.MAX && (<CtrlBtn icon={<FaFan size={22} color='orange' />} onClick={() => gen4__setCleaningMode(Neato.Gen4.CleaningMode.TURBO)} label={t('modes.max')} />)}
                            {gen4__cleaningMode === Neato.Gen4.CleaningMode.TURBO && (<CtrlBtn icon={<FaFan size={22} color='orange' />} onClick={() => gen4__setCleaningMode(Neato.Gen4.CleaningMode.ECO)} label={t('modes.turbo')} />)}
                        </>
                    )}

                </div>

                <div style={{ display: 'flex', flexDirection: 'row', gap: '2rem', paddingBottom: '2rem', alignItems: 'center' }}>
                    <CtrlBtn disabled={
                        robot.type === RobotType.NeatoGen3 ? !robot.availableCommands.stop :
                            robot.type === RobotType.NeatoGen4 ? !robot.availableCommands.cancel : true
                    } icon={<FaStop size={22} />} label={t('home.stop')} onClick={() => {
                        (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).stopCleaning(robot.serial);
                    }} />


                    {robot.availableCommands.pause ? (
                        <button className={`${styles.start} ${!robot.availableCommands.pause ? styles.disabled : ''}`} aria-label={t('home.pauseCleaning')} onClick={() => {
                            (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).pauseCleaning(robot.serial);
                        }}>
                            <IoMdPause size={34} />
                        </button>

                    ) :

                        robot.availableCommands?.resume ? (
                            <button className={`${styles.start} ${!robot.availableCommands?.resume ? styles.disabled : ''}`} aria-label={t('home.resumeCleaning')} onClick={() => {
                                (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).resumeCleaning(robot.serial)
                            }}>
                                <IoMdPlay size={34} />
                            </button>
                        ) : (
                            <button className={`${styles.start} ${!robot.availableCommands?.start ? styles.disabled : ''}`} aria-label={t('home.startCleaning')} onClick={async () => {

                                if (robot.type === RobotType.NeatoGen3) {
                                    if (gen3__cleaningCategory === CleaningCategory.SPOT) {
                                        GEN3_COMMANDS.startCleaningSpot(robot.serial, spotHeight, spotWidth, gen3__cleaningMode, gen3__navigationMode)
                                        return;
                                    }
                                    GEN3_COMMANDS.startCleaning(robot.serial, gen3__cleaningMode, gen3__navigationMode)
                                } else if (robot.type === RobotType.NeatoGen4) {
                                    // Gen4 Start depends on the selected category. The category
                                    // selector state is Gen3-typed but is just HOUSE/MAP/SPOT, so
                                    // it is reused here. Gen3 commands are never sent from this branch.
                                    const rankId = promotedFloorplan?.id ?? null

                                    if (gen3__cleaningCategory === CleaningCategory.SPOT) {
                                        // Gen4 spot clean is not implemented yet (needs the spot
                                        // protocol + user distances). Deferred to its own branch.
                                        console.warn('Gen4 spot cleaning not implemented yet')
                                        return;
                                    }

                                    if (!rankId) {
                                        // No promoted floorplan yet: the only sensible action is a
                                        // whole-map (exploration) clean.
                                        GEN4_COMMANDS.startCleaning(robot.serial, gen4__cleaningMode, gen4__navigationMode, null, null)
                                        return;
                                    }

                                    // Both HOUSE and MAP use the map's persisted config for no-go:
                                    // the floorplan holds ONE no-go union (firmware limit), applied
                                    // iff any no-go line is currently enabled on the map.
                                    let boundaries: any[] = []
                                    try {
                                        boundaries = (await Http.getBoundaries(robot.serial, rankId)).data ?? []
                                    } catch (e) {
                                        console.error('failed to load map boundaries for cleaning', e)
                                    }
                                    const nogoActive = boundaries.some(b => !b.deleted && b.enabled && (b.type === 'polyline' || b.function === 'nogo'))

                                    if (gen3__cleaningCategory === CleaningCategory.HOUSE) {
                                        // Whole floorplan, NOT restricted to zones, but honouring the
                                        // active no-go lines. Distinct from "explore new map"
                                        // (rankId=null) which lives in the map tab.
                                        GEN4_COMMANDS.startCleaning(robot.serial, gen4__cleaningMode, gen4__navigationMode, null, rankId, nogoActive)
                                        return;
                                    }

                                    // MAP: clean the map's persisted configuration - every ENABLED
                                    // cleaning zone, with the active no-go. Promote first so the
                                    // robot holds the current zone/no-go tracks (same as map tab).
                                    const zoneIds = boundaries
                                        .filter(b => !b.deleted && b.enabled && b.type === 'polygon' && b.function === 'cleaning')
                                        .map(b => b.id as string)
                                    try {
                                        await Http.test(robot.serial, rankId)
                                    } catch (e) {
                                        console.error('apply zones/no-go before cleaning failed', e)
                                    }
                                    await new Promise(r => setTimeout(r, 1000)) // let the robot commit the promote
                                    GEN4_COMMANDS.startCleaningZones(robot.serial, gen4__cleaningMode, gen4__navigationMode, rankId, zoneIds, nogoActive)
                                }
                            }}>
                                <IoMdPlay size={34} />
                            </button>
                        )
                    }


                    <CtrlBtn disabled={
                        robot.type === RobotType.NeatoGen3 ? !robot.availableCommands?.goToBase :
                            robot.type === RobotType.NeatoGen4 ? !robot.availableCommands?.return_to_base : true
                    } icon={<TbHome size={22} />} label={t('home.base')} onClick={() => {
                        (robot.type === RobotType.NeatoGen3 ? GEN3_COMMANDS : GEN4_COMMANDS).sendToBase(robot.serial)
                    }} />
                </div>



            </div>

            <Drawer open={categoryDrawerOpen} handle={false} onOpenChange={(open) => setCategoryDrawerOpen(open)} openHeightPercent={40} title={t('home.selectMode')}>
                <div className={styles.drawerContent}>
                    {/* Category Selection */}

                    <Input
                        type="select"
                        label={t('common.mode')}
                        options={[
                            { value: CleaningCategory.MAP, label: t('home.map') },
                            { value: CleaningCategory.HOUSE, label: t('home.house') },
                            { value: CleaningCategory.SPOT, label: t('home.spot') },
                        ]}
                        value={gen3__cleaningCategory}
                        onChange={(value) => gen3__setCleaningCategory(value)}
                        extraInfo={
                            gen3__cleaningCategory === CleaningCategory.MAP ? t('home.modeMapInfo') :
                                gen3__cleaningCategory === CleaningCategory.HOUSE ? t('home.modeHouseInfo') :
                                    gen3__cleaningCategory === CleaningCategory.SPOT ? t('home.modeSpotInfo') : ''
                        }
                    />


                    {/* Spot Settings */}
                    {gen3__cleaningCategory === CleaningCategory.SPOT && (
                        <div className={styles.spotSettings}>
                            {/* Height Slider */}
                            <div className={styles.sliderSection}>
                                <div className={styles.sliderLabel}>
                                    {t('home.height')}: <span className={styles.sliderValue}>{formatLength(spotHeight)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="100"
                                    max="400"
                                    value={spotHeight}
                                    onChange={(e) => setSpotHeight(Number(e.target.value))}
                                    className={styles.sliderInput}
                                />
                            </div>

                            {/* Width Slider */}
                            <div className={styles.sliderSection}>
                                <div className={styles.sliderLabel}>
                                    {t('home.width')}: <span className={styles.sliderValue}>{formatLength(spotWidth)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="100"
                                    max="400"
                                    value={spotWidth}
                                    onChange={(e) => setSpotWidth(Number(e.target.value))}
                                    className={styles.sliderInput}
                                />
                            </div>
                        </div>
                    )}

                    {/* OK Button */}
                    <button className={styles.okButton} onClick={() => setCategoryDrawerOpen(false)}>
                        {t('common.ok')}
                    </button>
                </div>
            </Drawer>

        </div>
    )
}
