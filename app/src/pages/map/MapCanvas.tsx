import { useState } from 'react'
import styles from './map.module.scss'
import { FaPlus, FaUndo } from 'react-icons/fa'
import { PiBoundingBox } from 'react-icons/pi'
import { DRAWING } from './constants'
import type { Point, UseState } from './types'
import { getCrosshairWorldCoords } from './utils'
import { useMap, type ExtraDrawFn } from '../../components/map/useMap'

// Single source of truth for the page's mode union — map.tsx imports this rather
// than declaring its own copy.
export type MapMode = 'maps' | 'map-edit' | 'boundaries' | 'boundary-info' | 'boundary-edit'

interface MapCanvasProps {
    mapId: string   // required, no `?` — this component simply doesn't exist without a map
    runId?: string  // genuinely optional: a map can be viewed with no run overlay
    mode: MapMode
    extraDraw?: ExtraDrawFn
    redrawKey?: unknown
    currentLinePoints: Point[]
    setCurrentLinePoints: UseState<Point[]>
    closedAsPolygon: boolean
    setClosedAsPolygon: UseState<boolean>
    setDrawerOpen: (open: boolean) => void
}

// Owns everything that genuinely can't exist without a selected map: the hook, the
// canvas element + its pan/zoom handlers, and the boundary-drawing action buttons
// (they all need canvasRef/zoom/offset to translate screen taps into map coords).
export default function MapCanvas({
    mapId,
    runId,
    mode,
    extraDraw,
    redrawKey,
    currentLinePoints,
    setCurrentLinePoints,
    closedAsPolygon,
    setClosedAsPolygon,
    setDrawerOpen
}: MapCanvasProps) {
    // Purely a "how close is the crosshair to the first point" UI flag — nothing outside
    // this component reads it, so it doesn't need to be lifted to the parent.
    const [showCloseAsPolygon, setShowCloseAsPolygon] = useState(false)

    const { canvasRef, mapSize, zoom, offset, isDragging, hasMoved, canvasHandlers } = useMap({
        mapId,
        runId,
        extraDraw,
        redrawKey,
        backgroundToken: '--map-editor-bg'
    })

    const addPointAtCrosshair = () => {
        const coords = getCrosshairWorldCoords(canvasRef, offset, zoom, mapSize)
        setCurrentLinePoints(prev => [...prev, coords])
    }

    const undo = () => {
        if (closedAsPolygon) {
            setClosedAsPolygon(false)
            return
        }
        if (currentLinePoints.length > 0) {
            setCurrentLinePoints(currentLinePoints.slice(0, -1))
        }
    }

    const closeAsPolygon = () => {
        setClosedAsPolygon(true)
        setDrawerOpen(true)
    }

    const onTouchMove = (e: React.TouchEvent) => {
        canvasHandlers.onTouchMove(e)
        if (currentLinePoints.length > 1 && mapSize) {
            const coords = getCrosshairWorldCoords(canvasRef, offset, zoom, mapSize)
            const [fx, fy] = currentLinePoints[0]
            const distance = Math.sqrt((coords[0] - fx) ** 2 + (coords[1] - fy) ** 2)
            setShowCloseAsPolygon(distance < DRAWING.CLOSE_THRESHOLD)
        }
    }

    const onTouchEnd = (e: React.TouchEvent) => {
        canvasHandlers.onTouchEnd(e)
        if (mode === 'boundary-edit' && !hasMoved) addPointAtCrosshair()
    }

    // Desktop parity: the touch handlers above drive point-adding and the
    // "close polygon" proximity flag; mirror them for the mouse so drawing and
    // closing a zone work with a pointer, not just a finger.
    const onMouseMove = (e: React.MouseEvent) => {
        canvasHandlers.onMouseMove(e)
        if (currentLinePoints.length > 1 && mapSize) {
            const coords = getCrosshairWorldCoords(canvasRef, offset, zoom, mapSize)
            const [fx, fy] = currentLinePoints[0]
            const distance = Math.sqrt((coords[0] - fx) ** 2 + (coords[1] - fy) ** 2)
            setShowCloseAsPolygon(distance < DRAWING.CLOSE_THRESHOLD)
        }
    }

    const onMouseUp = (e: React.MouseEvent) => {
        canvasHandlers.onMouseUp(e)
        if (mode === 'boundary-edit' && !hasMoved) addPointAtCrosshair()
    }

    return (
        <>
            <canvas
                ref={canvasRef}
                className={styles.canvas}
                onMouseDown={canvasHandlers.onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={canvasHandlers.onMouseLeave}
                onWheel={canvasHandlers.onWheel}
                onTouchStart={canvasHandlers.onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                style={{
                    cursor: mode === 'boundary-edit' ? 'crosshair' : isDragging ? 'grabbing' : 'grab',
                    touchAction: 'none'
                }}
            />

            {mode === 'boundary-edit' && (
                <div className={styles.actionButtons}>
                    <div onClick={undo} className={styles.undo}>
                        <FaUndo size={20} color="var(--text)" />
                    </div>
                    <div onClick={addPointAtCrosshair} className={`${styles.add} ${closedAsPolygon ? styles.disabled : ''}`}>
                        <FaPlus size={40} color="var(--text)" />
                    </div>
                    <div onClick={closeAsPolygon} className={`${styles.closePolygon} ${(showCloseAsPolygon && !closedAsPolygon) ? '' : styles.disabled}`}>
                        <PiBoundingBox size={20} color="var(--text)" />
                    </div>
                </div>
            )}
        </>
    )
}