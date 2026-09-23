// ============================================================================
// SUNFORGE RACERS - Centralized tuning configuration.
// Every gameplay-relevant number lives here so physics/AI/camera can be
// tuned without touching system code.
// Units: meters, seconds, radians. Speeds in m/s.
// ============================================================================

export const CONFIG = {
  race: {
    laps: 3,
    countdownTime: 3.0,          // seconds of 3-2-1 before GO
    // Holding throttle inside this window BEFORE "GO" arms a rocket start.
    startBoostArmWindow: 0.5,    // seconds before GO during which holding throttle counts
    startBoostGrace: 0.15,       // seconds after GO the hold still counts
    startBoost: { duration: 1.1, speedMult: 1.16, accelMult: 2.1 },
    resultsDelay: 2.4,           // slow-mo time before results screen
    slowMoOnFinish: 0.35,        // time scale after player finishes
    wrongWayTime: 1.1,           // seconds driving backwards before warning
  },

  vehicle: {
    maxSpeed: 30.0,              // m/s (~108 km/h)
    accel: 14.5,                 // m/s^2 base engine acceleration
    braking: 34.0,               // m/s^2
    coastDrag: 1.7,              // m/s^2 passive slowdown with no input
    drag: 0.10,                  // proportional drag coefficient
    reverseMax: 8.5,             // m/s
    reverseAccel: 11.0,          // m/s^2
    steerRate: 2.55,             // rad/s max yaw rate from steering
    steerRefSpeed: 9.0,          // speed at which steering reaches full authority
    steerHighSpeedDamp: 0.55,    // fraction of steer rate shed at top speed
    steerSmoothing: 8.0,         // how fast digital input becomes analog steer
    traction: 8.0,               // lateral grip decay rate (1/s)
    offTrackTraction: 3.0,
    offTrackDrag: 2.4,           // extra drag when off the road
    offTrackMaxSpeed: 11.0,
    collisionRadius: 1.45,
    wallRestitution: 0.35,
    kartRestitution: 0.45,
    bumpYawJitter: 0.05,         // rad destabilization on impacts
  },

  drift: {
    minSpeed: 10.0,              // need this much speed to start a drift
    steerThreshold: 0.25,        // steer amount needed to initiate
    steerMult: 0.62,             // steering authority while drifting
    driftStrength: 1.30,         // extra yaw rate (rad/s) rotating into the slide
    gripMult: 0.26,              // lateral traction while drifting (fraction)
    hopImpulse: 4.0,             // m/s upward hop when a drift starts
    chargeRate: 1.0,             // boost charge per second of drifting
    levels: [0.9, 1.9, 3.2],     // charge needed for L1/L2/L3
    exitSpeedFloor: 6.0,         // below this speed the drift ends
  },

  boost: {
    levels: [
      { duration: 0.95, speedMult: 1.17, accelMult: 2.0 },
      { duration: 1.55, speedMult: 1.27, accelMult: 2.35 },
      { duration: 2.35, speedMult: 1.42, accelMult: 2.75 },
    ],
    pad: { duration: 1.15, speedMult: 1.22, accelMult: 2.2, cooldown: 1.2 },
    steerRetention: 0.85,        // steering kept while boosting
    rampLaunchMult: 1.12,        // extra vertical punch leaving a ramp
  },

  air: {
    gravity: 16.5,               // slightly floaty for arcade feel
    airSteer: 0.55,              // steering authority in the air (fraction)
    trickTime: 0.72,             // seconds for a full aerial spin
    trickBoost: { duration: 0.6, speedMult: 1.12, accelMult: 1.9 },
    landingShakePerFallSpeed: 0.02,
  },

  camera: {
    fovBase: 63,
    fovSpeedAdd: 9,              // extra FOV at max speed
    fovBoostAdd: 7,              // extra FOV while boosting
    fovSmooth: 5.0,
    distance: 8.6,               // adjustable in settings
    distanceRange: [6.0, 12.0],
    height: 3.5,                 // adjustable in settings
    heightRange: [2.2, 6.0],
    lookAhead: 4.4,
    followSmooth: 6.0,
    turnSmooth: 5.2,
    shakeDecay: 2.8,
    collisionShake: 0.5,
    boostShake: 0.16,
    margin: 0.55,                // clearance kept from environment geometry
    minHeightAboveGround: 1.1,
  },

  recovery: {
    offTrackLimit: 2.4,          // seconds off-road before auto reset
    hardLimitLateral: 9.0,       // meters beyond road edge => instant reset
    resetDelay: 0.85,            // freeze time after a reset
    stuckSpeed: 1.2,
    stuckTime: 3.0,
  },

  ai: {
    lookaheadBase: 8.0,
    lookaheadSpeedK: 0.36,
    steerGain: 2.8,
    cornerLatAccel: 15.0,        // m/s^2 lateral budget used to derive corner speeds
    brakePlanningDecel: 16.0,    // how early AI brake for corners
    avoidanceRange: 9.0,
    recoveryTime: 2.2,
    // Personalities: no arbitrary speed cheats. Differences are skill & style.
    personalities: {
      aggressive: {
        displayName: 'ai.cinder',
        color: 0xd9452f, accent: 0xffd23f,
        targetSpeed: 1.0, cornerSpeed: 1.03, boostUse: 1.0,
        aggression: 0.9, blockiness: 0.2, mistakeRate: 0.045,
        startBoostChance: 0.7, driftEagerness: 1.0,
      },
      balanced: {
        displayName: 'ai.zephyr',
        color: 0x2fa877, accent: 0xd8f4e6,
        targetSpeed: 0.985, cornerSpeed: 1.0, boostUse: 0.7,
        aggression: 0.35, blockiness: 0.45, mistakeRate: 0.028,
        startBoostChance: 0.4, driftEagerness: 0.75,
      },
      defensive: {
        displayName: 'ai.bastion',
        color: 0x4159c9, accent: 0x9fb4ff,
        targetSpeed: 0.97, cornerSpeed: 0.965, boostUse: 0.55,
        aggression: 0.12, blockiness: 0.85, mistakeRate: 0.018,
        startBoostChance: 0.25, driftEagerness: 0.55,
      },
      // Additional rival personalities (Increment 6). Same contract as the
      // three above: none of them grants speed - targetSpeed stays <= 1.0 and
      // cornerSpeed never exceeds the 'aggressive' baseline of 1.03, so every
      // personality is a style/habit profile, never an upgrade.
      speedster: {
        displayName: 'ai.speedster',
        color: 0x2fd8c8, accent: 0xffe08a,
        targetSpeed: 1.0, cornerSpeed: 0.985, boostUse: 0.95,
        aggression: 0.5, blockiness: 0.15, mistakeRate: 0.035,
        startBoostChance: 0.6, driftEagerness: 0.95,
      },
      technical: {
        displayName: 'ai.technical',
        color: 0x8ab8e8, accent: 0xbaf0ff,
        targetSpeed: 0.985, cornerSpeed: 1.0, boostUse: 0.8,
        aggression: 0.25, blockiness: 0.5, mistakeRate: 0.02,
        startBoostChance: 0.45, driftEagerness: 0.85,
      },
      wildcard: {
        displayName: 'ai.wildcard',
        color: 0xff5df1, accent: 0xfff08a,
        targetSpeed: 0.99, cornerSpeed: 0.995, boostUse: 0.85,
        aggression: 0.75, blockiness: 0.1, mistakeRate: 0.09,
        startBoostChance: 0.8, driftEagerness: 1.0,
      },
      guardian: {
        displayName: 'ai.guardian',
        color: 0xc96f2a, accent: 0x8ad0ff,
        targetSpeed: 0.975, cornerSpeed: 0.975, boostUse: 0.6,
        aggression: 0.15, blockiness: 0.9, mistakeRate: 0.022,
        startBoostChance: 0.3, driftEagerness: 0.6,
      },
    },
  },

  particles: {
    dustCount: 700,
    sparkCount: 500,
  },
};

export const KMH = 3.6;
