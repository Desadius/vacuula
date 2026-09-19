import { useCallback } from 'react'
import { useRobot } from '../context/useRobot'
import { persistentMapsLoader } from '../loaders/resources'
import { Neato, RobotType } from '../types'

export function useGetPromotedFloorplan() {
    const { robot } = useRobot()
    const serial = robot.serial
    const type = robot.type
    const { data: persistentMaps } = persistentMapsLoader.useValue(serial)

    return useCallback(async (): Promise<Neato.Gen4.Floorplan | undefined> => {
        if (!serial || type !== RobotType.NeatoGen4) return undefined

        const maps = persistentMaps ?? await persistentMapsLoader.request(robot.serial)
        return (maps as Neato.Gen4.Floorplan[] | undefined)?.find(fp => fp.promoted)
    }, [serial, type, persistentMaps])
}