import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { Scene } from "@babylonjs/core/scene";
import type { Collider } from "../sim/physics/aabb";

/**
 * Havok, used for cosmetic physics only (debris from destroyed cover). The
 * results never feed back into the deterministic simulation. Loaded lazily so
 * the WASM is only fetched when the `destructibles` feature is on.
 */
export class Physics {
  private constructor(private readonly scene: Scene) {}

  static async create(
    scene: Scene,
    staticColliders: readonly Collider[],
  ): Promise<Physics | null> {
    try {
      const { default: HavokPhysics } = await import("@babylonjs/havok");
      const wasmUrl = new URL(
        "../../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm",
        import.meta.url,
      ).href;
      const hk = await HavokPhysics({ locateFile: () => wasmUrl });
      scene.enablePhysics(new Vector3(0, -14, 0), new HavokPlugin(true, hk));
      const p = new Physics(scene);
      p.addStaticWorld(staticColliders);
      return p;
    } catch (err) {
      console.warn("[physics] Havok unavailable, using simple debris", err);
      return null;
    }
  }

  private addStaticWorld(colliders: readonly Collider[]): void {
    // Invisible static proxies of the map so debris lands on floors and bounces off walls.
    for (const c of colliders) {
      if (c.breakHp !== undefined) continue;
      const m = CreateBox(
        "phys-static",
        {
          width: c.maxX - c.minX,
          height: c.maxY - c.minY,
          depth: c.maxZ - c.minZ,
        },
        this.scene,
      );
      m.position.set(
        (c.minX + c.maxX) / 2,
        (c.minY + c.maxY) / 2,
        (c.minZ + c.maxZ) / 2,
      );
      m.isVisible = false;
      m.isPickable = false;
      new PhysicsAggregate(
        m,
        PhysicsShapeType.BOX,
        { mass: 0, friction: 0.8, restitution: 0.1 },
        this.scene,
      );
    }
  }

  addDebris(mesh: Mesh, velocity: Vector3): { dispose(): void } {
    const agg = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.BOX,
      { mass: 0.6, friction: 0.6, restitution: 0.25 },
      this.scene,
    );
    agg.body.setLinearVelocity(velocity);
    agg.body.setAngularVelocity(
      new Vector3(
        Math.random() * 6 - 3,
        Math.random() * 6 - 3,
        Math.random() * 6 - 3,
      ),
    );
    return { dispose: () => agg.dispose() };
  }
}
