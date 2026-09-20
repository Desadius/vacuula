export type UseState<T> = React.Dispatch<React.SetStateAction<T>>


export type Point = [number, number]

export interface Zone {
    id: string
    name: string
    color: string
    type: 'polygon'
    vertices: Point[]
    enabled: boolean
    function: 'nogo' | 'cleaning' // only gen4, TODO: better system to separate them but meh
    deleted?: boolean // marks this boundary for explicit removal on next postBoundaries
}

export interface SetZone extends Zone {
    relevancy: Point
}

export interface NoGoLine {
    id: string
    name: string
    color: string
    type: 'polyline'
    vertices: Point[]
    enabled: boolean
    deleted?: boolean // marks this boundary for explicit removal on next postBoundaries
}

export interface Offset {
    x: number
    y: number
}

export interface TouchState {
    distance: number
    angle: number
}
