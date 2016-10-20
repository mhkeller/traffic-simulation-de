
// general comments: ring.js, offramp.js (responsive design)

// #############################################################
// Initial settings
// #############################################################

// graphical settings

var hasChanged = true // window dimensions have changed (responsive design)

var drawBackground = true // if false, default unicolor background
var drawRoad = true // if false, only vehicles are drawn

var vmin = 0 // min speed for speed colormap (drawn in red)
var vmax = 100 / 3.6 // max speed for speed colormap (drawn in blue-violet)

// physical geometry settings [m]

var sizePhys = 355    // responsive design
var center_xPhys = 95
var center_yPhys = -105 // ypixel downwards=> physical center <0 responsive

var mainroadLen = 770
var nLanes = 3
var laneWidth = 7
var laneWidthRamp = 5

var straightLen = 0.34 * mainroadLen      // straight segments of U
var arcLen = mainroadLen - 2 * straightLen // length of half-circe arc of U
var arcRadius = arcLen / Math.PI

var offLen = 250
var divergeLen = 100
var offRadius = 1.6 * arcRadius
var taperLen = 40

var mainOffOffset = mainroadLen - straightLen

// specification of vehicle and traffic  properties

var car_length = 7 // car length in m
var car_width = 5 // car width in m
var truck_length = 15 // trucks
var truck_width = 7

// initial parameter settings (!! transfer def to GUI if variable in sliders!)

var MOBIL_bSafe = 4
var MOBIL_bSafeMax = 17
var MOBIL_bThr = 0.2
var MOBIL_bBiasRight_car = -0.01
var MOBIL_bBiasRight_truck = 0.1

var MOBIL_mandat_bSafe = 25
var MOBIL_mandat_bThr = 0
var MOBIL_mandat_bias = 25

var dt_LC = 4 // duration of a lane change

// simulation initial conditions settings
// (initial values and range of user-ctrl var in gui.js)

var speedInit = 20 // m/s
var densityInit = 0.001
var speedInitPerturb = 13
var relPosPerturb = 0.8
var truckFracToleratedMismatch = 0.2 // open system: need tolerance, otherwise sudden changes

// ############################################################################
// image file settings
// ############################################################################

var car_srcFile = 'figs/blackCarCropped.gif'
var truck_srcFile = 'figs/truck1Small.png'
var obstacle_srcFile = 'figs/obstacleImg.png'
var road1lane_srcFile = 'figs/oneLaneRoadRealisticCropped.png'
var road2lanes_srcFile = 'figs/twoLanesRoadRealisticCropped.png'
var road3lanes_srcFile = 'figs/threeLanesRoadRealisticCropped.png'
var ramp_srcFile = 'figs/oneLaneRoadRealisticCropped.png'

// Notice: set drawBackground=false if no bg wanted
var background_srcFile = 'figs/backgroundGrass.jpg'

// #################################
// Global graphics specification
// #################################

var canvas
var ctx  // graphics context

var background

// ###############################################################
// physical (m) road, vehicle and model specification
// ###############################################################

// IDM_v0 etc and updateModels() with actions  "longModelCar=new IDM(..)" etc
// defined in gui.js

var longModelCar
var longModelTruck
var LCModelCar
var LCModelTruck
var LCModelMandatoryRight = new MOBIL(MOBIL_mandat_bSafe, MOBIL_mandat_bSafe,
            MOBIL_mandat_bThr, MOBIL_mandat_bias)
var LCModelMandatoryLeft = new MOBIL(MOBIL_mandat_bSafe, MOBIL_mandat_bSafe,
            MOBIL_mandat_bThr, -MOBIL_mandat_bias)
updateModels()

// construct network

var isRing = 0  // 0: false; 1: true
duTactical = 150 // anticipation distance for applying mandatory LC rules

var mainroad = new road(1, mainroadLen, nLanes, densityInit, speedInit,
          truckFracInit, isRing)
var offramp = new road(2, offLen, 1, 0.1 * densityInit, speedInit, truckFracInit, isRing)

var offrampIDs = [2]
var offrampLastExits = [mainOffOffset + divergeLen]
var offrampToRight = [true]
mainroad.setOfframpInfo(offrampIDs, offrampLastExits, offrampToRight)
mainroad.duTactical = duTactical
mainroad.LCModelMandatoryRight = LCModelMandatoryRight // unique mandat LC model
mainroad.LCModelMandatoryLeft = LCModelMandatoryLeft // unique mandat LC model

// console.log("mainroad.offrampLastExits[0]=",mainroad.offrampLastExits[0]);
// console.log("fracOff="+fracOff);
var route1 = [1]  // stays on mainroad
var route2 = [1, 2] // takes offramp
for (var i = 0; i < mainroad.veh.length; i++) {
  mainroad.veh[i].route = (Math.random() < fracOff) ? route2 : route1
    // console.log("mainroad.veh["+i+"].route="+mainroad.veh[i].route);
}

// ############################################
// run-time specification and functions
// ############################################

var time = 0
var itime = 0
var fps = 30 // frames per second
var dt = timewarp / fps

// #################################################################
function updateU () {
// #################################################################

    // update times

  time += dt // dt depends on timewarp slider (fps=const)
  itime++

    // transfer effects from slider interaction and mandatory regions
    // to the vehicles and models:

  mainroad.updateModelsOfAllVehicles(longModelCar, longModelTruck,
               LCModelCar, LCModelTruck)
              // LCModelMandatoryRight,
              // LCModelMandatoryLeft);
  mainroad.updateTruckFrac(truckFrac, truckFracToleratedMismatch)
  offramp.updateModelsOfAllVehicles(longModelCar, longModelTruck,
              LCModelCar, LCModelTruck)
              // LCModelMandatoryRight,
              // LCModelMandatoryLeft);
  offramp.updateTruckFrac(truckFrac, truckFracToleratedMismatch)

    // if applicable, impose
    // externally mandatory LC behaviour in merging regions of on-ramps

    // do central simulation update of vehicles

  mainroad.updateLastLCtimes(dt)
  mainroad.calcAccelerations()
  mainroad.changeLanes()
  mainroad.updateSpeedPositions()
  mainroad.updateBCdown()
  var route = (Math.random() < fracOff) ? route2 : route1
  mainroad.updateBCup(qIn, dt, route) // qIn=total inflow, route opt. arg.

  offramp.updateLastLCtimes(dt) // needed since LC from main road!!
  offramp.calcAccelerations()
  offramp.updateSpeedPositions()
  offramp.updateBCdown()

    // template: mergeDiverge(newRoad,offset,uStart,uEnd,isMerge,toRight)

  var u_antic = 20
  mainroad.mergeDiverge(offramp, -mainOffOffset,
        mainOffOffset + taperLen, mainOffOffset + divergeLen - u_antic,
        false, true)

    // logging

    // offramp.writeVehiclesSimple();

  if (false) {
    console.log('\nafter updateU: itime=' + itime + ' mainroad.nveh=' + mainroad.nveh)
    for (var i = 0; i < mainroad.veh.length; i++) {
      console.log('i=' + i + ' mainroad.veh[i].u=' + mainroad.veh[i].u
      + ' mainroad.veh[i].v=' + mainroad.veh[i].v
      + ' mainroad.veh[i].lane=' + mainroad.veh[i].lane
      + ' mainroad.veh[i].laneOld=' + mainroad.veh[i].laneOld)
    }
    console.log('\n')
  }
}// updateU

// ##################################################
function drawU () {
// ##################################################

    // resize drawing region if browser's dim has changed (responsive design)
    // canvas_resize(canvas,aspectRatio)
  hasChanged = canvas_resize(canvas, 1.55)
  if (hasChanged) {
    console.log(' new canvas size ', canvas.width, 'x', canvas.height)
  }

   // (1) define geometry of "U" (road center) as parameterized function of
   // the arc length u

  function traj_x (u) { // physical coordinates
    var dxPhysFromCenter = // left side (median), phys coordinates
      (u < straightLen) ? straightLen - u
    : (u > straightLen + arcLen) ? u - mainroadLen + straightLen
    : -arcRadius * Math.sin((u - straightLen) / arcRadius)
    return center_xPhys + dxPhysFromCenter
  }

  function traj_y (u) { // physical coordinates
    var dyPhysFromCenter =
      (u < straightLen) ? arcRadius
    : (u > straightLen + arcLen) ? -arcRadius
    : arcRadius * Math.cos((u - straightLen) / arcRadius)
    return center_yPhys + dyPhysFromCenter
  }

  function trajOff_x (u) { // physical coordinates
    var xDivergeBegin = traj_x(mainOffOffset)
    return (u < divergeLen)
      ? xDivergeBegin + u
      : xDivergeBegin + divergeLen + offRadius * Math.sin((u - divergeLen) / offRadius)
  }

  function trajOff_y (u) { // physical coordinates
    var yDivergeBegin = traj_y(mainOffOffset)
      - 0.5 * laneWidth * (mainroad.nLanes + offramp.nLanes) - 0.02 * laneWidth
    return (u < taperLen)
            ? yDivergeBegin + laneWidth - laneWidth * u / taperLen : (u < divergeLen)
      ? yDivergeBegin
      : yDivergeBegin - offRadius * (1 - Math.cos((u - divergeLen) / offRadius))
  }

  mainroad.updateOrientation() // update heading of all vehicles rel. to road axis
                                  // (for some reason, strange rotations at beginning)

    // (2) reset transform matrix and draw background
    // (only needed if no explicit road drawn)
    // "%20-or condition"
    //  because some older firefoxes do not start up properly?

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (drawBackground) {
    if (hasChanged || (itime <= 1) || false || (!drawRoad)) {
        // var scaleImg=scaleFactorImg;// responsive design: weg
        // responsive design
  // ctx.drawImage(background,0,0,scaleImg*canvas.width,scaleImg*canvas.height);
      ctx.drawImage(background, 0, 0, canvas.width, canvas.height)
    }
  }

    // (3) draw mainroad and ramps (offramp "bridge" => draw last)
    // and vehicles (directly after frawing resp road or separately, depends)

  offramp.draw(rampImg, scale, trajOff_x, trajOff_y, laneWidthRamp)
  mainroad.draw(roadImg, scale, traj_x, traj_y, laneWidth)

  offramp.drawVehicles(carImg, truckImg, obstacleImg, scale,
       trajOff_x, trajOff_y, laneWidth, vmin, vmax)
  mainroad.drawVehicles(carImg, truckImg, obstacleImg, scale,
        traj_x, traj_y, laneWidth, vmin, vmax)

    // (4) draw some running-time vars
  if (true) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    var textsize = 0.02 * canvas.height
    // var textsize=scale*20;
    ctx.font = textsize + 'px Arial'

    var timeStr = 'Time=' + Math.round(10 * time) / 10
    var timeStr_xlb = textsize

    var timeStr_ylb = 1.8 * textsize
    var timeStr_width = 6 * textsize
    var timeStr_height = 1.2 * textsize

    ctx.fillStyle = 'rgb(255,255,255)'
    ctx.fillRect(timeStr_xlb, timeStr_ylb - timeStr_height,
     timeStr_width, timeStr_height)
    ctx.fillStyle = 'rgb(0,0,0)'
    ctx.fillText(timeStr, timeStr_xlb + 0.2 * textsize,
     timeStr_ylb - 0.2 * textsize)

    var timewStr = 'timewarp=' + Math.round(10 * timewarp) / 10
    var timewStr_xlb = 8 * textsize
    var timewStr_ylb = timeStr_ylb
    var timewStr_width = 7 * textsize
    var timewStr_height = 1.2 * textsize
    ctx.fillStyle = 'rgb(255,255,255)'
    ctx.fillRect(timewStr_xlb, timewStr_ylb - timewStr_height,
     timewStr_width, timewStr_height)
    ctx.fillStyle = 'rgb(0,0,0)'
    ctx.fillText(timewStr, timewStr_xlb + 0.2 * textsize,
     timewStr_ylb - 0.2 * textsize)

    var scaleStr = 'scale=' + Math.round(10 * scale) / 10
    var scaleStr_xlb = 16 * textsize
    var scaleStr_ylb = timeStr_ylb
    var scaleStr_width = 5 * textsize
    var scaleStr_height = 1.2 * textsize
    ctx.fillStyle = 'rgb(255,255,255)'
    ctx.fillRect(scaleStr_xlb, scaleStr_ylb - scaleStr_height,
     scaleStr_width, scaleStr_height)
    ctx.fillStyle = 'rgb(0,0,0)'
    ctx.fillText(scaleStr, scaleStr_xlb + 0.2 * textsize,
     scaleStr_ylb - 0.2 * textsize)

    var genVarStr = 'truckFrac=' + Math.round(100 * truckFrac) + '\%'
    var genVarStr_xlb = 24 * textsize
    var genVarStr_ylb = timeStr_ylb
    var genVarStr_width = 7.2 * textsize
    var genVarStr_height = 1.2 * textsize
    ctx.fillStyle = 'rgb(255,255,255)'
    ctx.fillRect(genVarStr_xlb, genVarStr_ylb - genVarStr_height,
     genVarStr_width, genVarStr_height)
    ctx.fillStyle = 'rgb(0,0,0)'
    ctx.fillText(genVarStr, genVarStr_xlb + 0.2 * textsize,
     genVarStr_ylb - 0.2 * textsize)

    var genVarStr = 'qIn=' + Math.round(3600 * qIn) + 'veh/h'
    var genVarStr_xlb = 32 * textsize
    var genVarStr_ylb = timeStr_ylb
    var genVarStr_width = 7.2 * textsize
    var genVarStr_height = 1.2 * textsize
    ctx.fillStyle = 'rgb(255,255,255)'
    ctx.fillRect(genVarStr_xlb, genVarStr_ylb - genVarStr_height,
     genVarStr_width, genVarStr_height)
    ctx.fillStyle = 'rgb(0,0,0)'
    ctx.fillText(genVarStr, genVarStr_xlb + 0.2 * textsize,
     genVarStr_ylb - 0.2 * textsize)

    // (6) draw the speed colormap

    drawColormap(scale * center_xPhys, -scale * center_yPhys, scale * 50, scale * 50,
     vmin, vmax, 0, 100 / 3.6)

    // revert to neutral transformation at the end!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }
}

// ############################################
// initialization function of the simulation thread
// THIS function does all the things; everything else only functions
// ultimately called by init()
// activation of init:
// (i) automatically when loading the simulation ("var myRun=init();" below)
// (ii) when pressing the start button defined in offramp_gui.js ("myRun=init();")
// "var ..." Actually does something;
// function keyword [function fname(..)] defines only
// ############################################

function init () {
  canvas = document.getElementById('canvas_offramp') // "canvas_offramp" defined in offramp.html
  ctx = canvas.getContext('2d')
  canvas_resize(canvas, 1.65)

  background = new Image()
  background.src = background_srcFile
    // console.log("image size of background:"+background.naturalWidth);

    // init vehicle image(s)

  carImg = new Image()
  carImg.src = car_srcFile
  truckImg = new Image()
  truckImg.src = truck_srcFile
  obstacleImg = new Image()
  obstacleImg.src = obstacle_srcFile

  // init road image(s)

  roadImg = new Image()
  roadImg.src = (nLanes == 1)
  ? road1lane_srcFile
  : (nLanes == 2) ? road2lanes_srcFile
  : road3lanes_srcFile
  rampImg = new Image()
  rampImg.src = ramp_srcFile

    // apply externally functions of mouseMove events  to initialize sliders settings

  console.log('timewarp=', timewarp)
  change_timewarpSliderPos(timewarp)
    // change_scaleSliderPos(scale); // responsive
  change_truckFracSliderPos(truckFrac)
  change_qInSliderPos(qInInit)
  change_fracOffSliderPos(fracOffInit)

  change_IDM_v0SliderPos(IDM_v0)
  change_IDM_TSliderPos(IDM_T)
  change_IDM_s0SliderPos(IDM_s0)
  change_IDM_aSliderPos(IDM_a)
  change_IDM_bSliderPos(IDM_b)

    // starts simulation thread "main_loop" (defined below)
    // with update time interval 1000/fps milliseconds
    // thread starts with "var myRun=init();" or "myRun=init();" (below)
    // thread stops with "clearInterval(myRun);"

  return setInterval(main_loop, 1000 / fps)
} // end init()

// ##################################################
// Running function of the sim thread (triggered by setInterval)
// ##################################################

function main_loop () {
  drawU()
  updateU()
    // mainroad.writeVehicles(); // for debugging
}

// ##################################################
// Actual start of the simulation thread
// (also started from gui.js "Offramp" button)
// everything w/o function keyword [function f(..)]" actually does something, not only def
// ##################################################

var myRun = init()

