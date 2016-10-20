// #############################################################
// Physical dynamics of the vehicles on a road section
// #############################################################

//! !! => plan: see README_routing

// #########################################
// object cstr for a road
// #########################################

function road (roadID, roadLen, nLanes, densInitPerLane, speedInit, truckFracInit, isRing) {
  this.roadID = roadID
  this.roadLen = roadLen
  this.nLanes = nLanes
  this.nveh = Math.floor(this.nLanes * this.roadLen * densInitPerLane)

    // network related properties

  this.isRing = isRing
  this.inVehBuffer = 0 // number of waiting vehicles; if>=1, updateBCup called
  this.iOffset = 0 // set by getTargetNeighbourhood: first veh in defined region

  this.offrampIDs = [] // which offramps are attached to this road?
  this.offrampLastExits = [] // locations? (increasing u)
  this.offrampToRight = [] // offramp attached to the right?

  this.duTactical = -1e-6 // if duAntic>0 activate tactical changes for mandat. LC

    // model parameters

  this.MOBIL_bSafeMandat = 6 // mandat LC and merging for v=v0
  this.MOBIL_bSafeMax = 17 //! !! mandat LC and merging for v=0

    // default LC models for mandatory lane changes
    // MOBIL(bSafe,bThr,bias)
    //! ! only for preparing diverges! Actual merging with separate function!!

  this.LCModelMandatoryRight = new MOBIL(this.MOBIL_bSafeMandat,
           this.MOBIL_bSafeMax,
           0, 0.5 * this.MOBIL_bSafeMax)
  this.LCModelMandatoryLeft = new MOBIL(this.MOBIL_bSafeMandat,
           this.MOBIL_bSafeMandat,
          0, -0.5 * this.MOBIL_bSafeMax)

    // drawing-related vatiables

  this.draw_scaleOld = 0
  this.draw_nSegm = 100
  this.draw_curvMax = 0.01 // maximum assmued curvature

  this.draw_x = []  // arrays defined in the draw(..) method
  this.draw_y = []
  this.draw_phi = []
  this.draw_cosphi = []
  this.draw_sinphi = []

    // construct vehicle array

  this.veh = []
  for (var i = 0; i < this.nveh; i++) {
        // position trucks mainly on the right lane nLanes-1

    var lane = i % this.nLanes // left: 0; right: nLanes-1
    var truckFracRight = Math.min(this.nLanes * truckFracInit, 1)
    var truckFracRest = (this.nLanes * truckFracInit > 1)
      ? ((this.nLanes * truckFracInit - 1) / (this.nLanes - 1)) : 0
    var truckFrac = (lane == this.nLanes - 1) ? truckFracRight : truckFracRest
    var r = Math.random()
    var vehType = (Math.random() < truckFrac) ? 'truck' : 'car'
    var vehLength = (vehType == 'car') ? car_length : truck_length
    var vehWidth = (vehType == 'car') ? car_width : truck_width

        // actually construct vehicles

    this.veh[i] = new vehicle(vehLength, vehWidth,
         (this.nveh - i - 1) * this.roadLen / (this.nveh + 1),
         i % this.nLanes, 0.8 * speedInit, vehType)

    this.veh[i].longModel = (vehType == 'car')
      ? longModelCar : longModelTruck
    this.veh[i].LCModel = (vehType == 'car')
      ? LCModelCar : LCModelTruck
  }

    // this.writeVehicles();
}

// ######################################################################
// ######################################################################

road.prototype.writeVehicles = function () {
  console.log('\nin road.writeVehicles(): roadLen=' + this.roadLen)
  for (var i = 0; i < this.veh.length; i++) {
    console.log(' veh[' + i + '].u=' + parseFloat(this.veh[i].u, 10).toFixed(1)
       + '  lane=' + this.veh[i].lane
       + '  speed=' + parseFloat(this.veh[i].speed, 10).toFixed(1)
       + '  acc=' + parseFloat(this.veh[i].acc, 10).toFixed(1)
       + '  iLead=' + this.veh[i].iLead
       + '  iLag=' + this.veh[i].iLag
       + '  iLeadRight=' + this.veh[i].iLeadRight
       + '  iLagRight=' + this.veh[i].iLagRight
       + '  iLeadLeft=' + this.veh[i].iLeadLeft
       + '  iLagLeft=' + this.veh[i].iLagLeft
       + '')
  }
}

// ######################################################################
// ######################################################################

road.prototype.writeVehiclesSimple = function () {
  console.log('\nin road.writeVehicles(): roadLen=' + this.roadLen)
  for (var i = 0; i < this.veh.length; i++) {
    console.log(' veh[' + i + '].u=' + parseFloat(this.veh[i].u, 10).toFixed(1)
       + '  lane=' + this.veh[i].lane
       + '  speed=' + parseFloat(this.veh[i].speed, 10).toFixed(1)
       + '  acc=' + parseFloat(this.veh[i].acc, 10).toFixed(1)
       + '')
  }
}

// #####################################################
// get network info of offramps attached to this road (for routing)
// see also updateModelsOfAllVehicles
// #####################################################

road.prototype.setOfframpInfo
 = function (offrampIDs, offrampLastExits, offrampToRight) {
   this.offrampIDs = offrampIDs
   this.offrampLastExits = offrampLastExits // road.u at begin of diverge
   this.offrampToRight = offrampToRight // whether offramp is to the right
 }

// ##################################################################
// get next offramp index for a given longitudinal position u (routing)
// ##################################################################

road.prototype.getNextOffIndex = function (u) {
  var index = -1
  var success = false

    // this.offrampLastExits[iOff] increasing with iOff
  for (var iOff = 0; (!success) && (iOff < this.offrampIDs.length); iOff++) {
    success = (this.offrampLastExits[iOff] > u)
    if (success) { index = iOff }
  }
  return index
}

// #####################################################
// set vehicles in range to new CF models
// (useful for modeling flow-conserving bottlenecks)
// #####################################################

road.prototype.setCFModelsInRange
    = function (umin, umax, longModelCar, longModelTruck) {
      for (var i = 0; i < this.veh.length; i++) {
        var u = this.veh[i].u
        if ((u > umin) && (u < umax)) {
          if (this.veh[i].type == 'car') { this.veh[i].longModel = longModelCar }
          if (this.veh[i].type == 'truck') { this.veh[i].longModel = longModelTruck }
        }
      }
    }

// #####################################################
// set vehicles in range to mandatory LC
// (useful for non-routing related mandatory LC onramps (no offramps), e.g.
// onramps or before lane closings
// see also updateModelsOfAllVehicles
// #####################################################

road.prototype.setLCMandatory = function (umin, umax, toRight) {
  for (var i = 0; i < this.veh.length; i++) {
    var u = this.veh[i].u
    if ((u > umin) && (u < umax)) {
      this.veh[i].mandatoryLCahead = true
      this.veh[i].toRight = toRight
      this.veh[i].LCModel = (toRight)
    ? this.LCModelMandatoryRight : this.LCModelMandatoryLeft
    }
  }
}

// #####################################################
// sort vehicles into descending arc-length positions u
// #####################################################

road.prototype.sortVehicles = function () {
  if (this.veh.length > 2) {
    this.veh.sort(function (a, b) {
      return b.u - a.u
    })
  };
}

// #####################################################
/**
  functions for getting/updating the vehicle environment of a vehicle array
  sorted into descending arc-length positions u

  vehicle indices iLead, iLag, iLeadLeft, iLeadRight, iLagLeft, iLagRight

  if i==0 (first vehicle) leader= last vehicle also for non-ring roads
  if i==nveh-1 (last vehicle) follower= first vehicle also for non-ring roads
  same for iLeadLeft, iLeadRight, iLagLeft, iLagRight
   !! should be caught by BC or by setting gap very large

  if only one vehicle on its lane, then iLead=iLag=i (vehicles identical)
  if no vehicle on right, left lanes, then iLeadRight=iLagRight=i, same left

  if no right lane for vehicle i, iLeadRight, iLagRight set to -10
  if no left lane for vehicle i, iLeadLeft, iLagLeft set to -10
 */
// #####################################################

  // get/update leader

road.prototype.update_iLead = function (i) {
  var n = this.nveh
  this.veh[i].iLeadOld = this.veh[i].iLead
  var iLead = (i == 0) ? n - 1 : i - 1  // also for non periodic BC
  success = (this.veh[iLead].lane == this.veh[i].lane)
  while (!success) {
    iLead = (iLead == 0) ? n - 1 : iLead - 1
    success = ((i == iLead) || (this.veh[iLead].lane == this.veh[i].lane))
  }
  this.veh[i].iLead = iLead
}

     // get/update follower

road.prototype.update_iLag = function (i) {
  var n = this.nveh
  this.veh[i].iLagOld = this.veh[i].iLag
  var iLag = (i == n - 1) ? 0 : i + 1
  success = (this.veh[iLag].lane == this.veh[i].lane)
  while (!success) {
    iLag = (iLag == n - 1) ? 0 : iLag + 1
    success = ((i == iLag) || (this.veh[iLag].lane == this.veh[i].lane))
  }
  this.veh[i].iLag = iLag
}

   // get leader to the right

road.prototype.update_iLeadRight = function (i) {
  var n = this.nveh
  this.veh[i].iLeadRightOld = this.veh[i].iLeadRight
  var iLeadRight
  if (this.veh[i].lane < this.nLanes - 1) {
    iLeadRight = (i == 0) ? n - 1 : i - 1
    success = ((i == iLeadRight) || (this.veh[iLeadRight].lane == this.veh[i].lane + 1))
    while (!success) {
      iLeadRight = (iLeadRight == 0) ? n - 1 : iLeadRight - 1
      success = ((i == iLeadRight) || (this.veh[iLeadRight].lane == this.veh[i].lane + 1))
    }
  }
  else { iLeadRight = -10 }
  this.veh[i].iLeadRight = iLeadRight
}

    // get follower to the right

road.prototype.update_iLagRight = function (i) {
  var n = this.nveh
  this.veh[i].iLagRightOld = this.veh[i].iLagRight
  var iLagRight
  if (this.veh[i].lane < this.nLanes - 1) {
    iLagRight = (i == n - 1) ? 0 : i + 1
    success = ((i == iLagRight) || (this.veh[iLagRight].lane == this.veh[i].lane + 1))
    while (!success) {
      iLagRight = (iLagRight == n - 1) ? 0 : iLagRight + 1
      success = ((i == iLagRight) || (this.veh[iLagRight].lane == this.veh[i].lane + 1))
    }
  }
  else { iLagRight = -10 }
  this.veh[i].iLagRight = iLagRight
}

    // get leader to the left

road.prototype.update_iLeadLeft = function (i) {
  var n = this.nveh
  this.veh[i].iLeadLeftOld = this.veh[i].iLeadLeft

  var iLeadLeft
  if (this.veh[i].lane > 0) {
    iLeadLeft = (i == 0) ? n - 1 : i - 1
    success = ((i == iLeadLeft) || (this.veh[iLeadLeft].lane == this.veh[i].lane - 1))
    while (!success) {
      iLeadLeft = (iLeadLeft == 0) ? n - 1 : iLeadLeft - 1
      success = ((i == iLeadLeft) || (this.veh[iLeadLeft].lane == this.veh[i].lane - 1))
    }
  }
  else { iLeadLeft = -10 }
  this.veh[i].iLeadLeft = iLeadLeft
}

    // get follower to the left

road.prototype.update_iLagLeft = function (i) {
  var n = this.nveh
  var iLagLeft
  this.veh[i].iLagLeftOld = this.veh[i].iLagLeft

  if (this.veh[i].lane > 0) {
    iLagLeft = (i == n - 1) ? 0 : i + 1
    success = ((i == iLagLeft) || (this.veh[iLagLeft].lane == this.veh[i].lane - 1))
    while (!success) {
      iLagLeft = (iLagLeft == n - 1) ? 0 : iLagLeft + 1
      success = ((i == iLagLeft) || (this.veh[iLagLeft].lane == this.veh[i].lane - 1))
    }
  }
  else { iLagLeft = -10 }
  this.veh[i].iLagLeft = iLagLeft
}

// #####################################################
// get/update environment iLead, iLag, iLeadLeft,... for all vehicles
// #####################################################

road.prototype.updateEnvironment = function () {
  for (var i = 0; i < this.nveh; i++) {
        // get leader
    this.update_iLead(i)

        // get follower
    this.update_iLag(i)

        // get leader to the right (higher lane index)
    this.update_iLeadRight(i)

        // get follower to the right
    this.update_iLagRight(i)

        // get leader to the left (lower lane index)
    this.update_iLeadLeft(i)

        // get follower to the left
    this.update_iLagLeft(i)
  }
}

// ######################################################################
// main calculation of accelerations
// ######################################################################

road.prototype.calcAccelerations = function () {
  for (var i = 0; i < this.nveh; i++) {
    var iLead = this.veh[i].iLead
    var s = this.veh[iLead].u - this.veh[iLead].length - this.veh[i].u
    if (iLead >= i) { // vehicle is leader
      if (this.isRing) { s += this.roadLen } // periodic BC
      else { s = 10000 } // free outflow BC: virtual vehicle 10km away
    }
    this.veh[i].acc = this.veh[i].longModel.calcAcc(s, this.veh[i].speed,
                  this.veh[iLead].speed)
    if (false) {
  // if(this.veh[i].mandatoryLCahead){
      console.log('calcAccelerations: i=' + i
      + ' u=' + this.veh[i].u
      + ' mandatoryLCahead=' + this.veh[i].mandatoryLCahead
      + ' alpha_v0=' + this.veh[i].longModel.alpha_v0
           )
    }
  }
}

// ######################################################################
// main kinematic update (ballistic update scheme)
// including ring closure if isRing
// ######################################################################

road.prototype.updateSpeedPositions = function () {
  for (var i = 0; i < this.nveh; i++) {
    this.veh[i].u += Math.max(0, this.veh[i].speed * dt + 0.5 * this.veh[i].acc * dt * dt)

    if (this.isRing && (this.veh[i].u > this.roadLen)) { this.veh[i].u -= this.roadLen } // periodic BC

    this.veh[i].speed += this.veh[i].acc * dt
    if (this.veh[i].speed < 0) { this.veh[i].speed = 0 }

    // update drawing coordinates: get_v (fractional lane)

    this.veh[i].v = get_v(this.veh[i].dt_lastLC, dt_LC, this.veh[i].laneOld,
      this.veh[i].lane)
  }

  this.updateOrientation() // drawing: get heading relative to road from path.js
  this.sortVehicles() // positional update may have disturbed sorting (if passing)
  this.updateEnvironment()
}

// ######################################################################
// main lane changing routine (model MOBIL without politeness)
// toRight=true: tests/performs change to the right; otherwise to the left
// returns true if change took place
// ######################################################################

road.prototype.changeLanes = function () {
  this.doChangesInDirection(1) // changes to right
  this.doChangesInDirection(0) // changes to left
}

road.prototype.doChangesInDirection = function (toRight) {
  var log = false
  var waitTime = 2 * dt_LC
  // changeSuccessful=0; //return value; initially false

  if (log && toRight) { console.log('changeLanes: before changes to the right') }
  if (log && (!toRight)) { console.log('changeLanes: before changes to the left') }

  for (var i = 0; i < this.nveh; i++) {
    // test if there is a target lane and if last change is sufficiently long ago

    var newLane = (toRight) ? this.veh[i].lane + 1 : this.veh[i].lane - 1
    if ((newLane >= 0) && (newLane < this.nLanes) && (this.veh[i].dt_lastLC > waitTime)) {
      var iLead = this.veh[i].iLead
      var iLag = this.veh[i].iLag // actually not used
      var iLeadNew = (toRight) ? this.veh[i].iLeadRight : this.veh[i].iLeadLeft
      var iLagNew = (toRight) ? this.veh[i].iLagRight : this.veh[i].iLagLeft

      // check if also the new leader/follower did not change recently

      if ((this.veh[iLeadNew].dt_lastLC > waitTime)
   && (this.veh[iLagNew].dt_lastLC > waitTime)) {
        var acc = this.veh[i].acc
        var speed = this.veh[i].speed
        var speedLeadNew = this.veh[iLeadNew].speed
        var sNew = this.veh[iLeadNew].u - this.veh[iLeadNew].length - this.veh[i].u

         // treat case that no leader/no veh at all on target lane

        if (iLeadNew >= i) { // if iLeadNew=i => laneNew is empty
          if (this.isRing) { sNew += this.roadLen } // periodic BC
          else { sNew = 10000 }
        }

         // treat case that no follower/no veh at all on target lane

        if (iLagNew <= i) { // if iLagNew=i => laneNew is empty
          if (this.isRing) { sLagNew += this.roadLen } // periodic BC
          else { sLagNew = 10000 }
        }

         // calculate MOBIL input

        var vrel = this.veh[i].speed / this.veh[i].longModel.v0
        var accNew = this.veh[i].longModel.calcAcc(sNew, speed, speedLeadNew)
        var sLagNew = this.veh[i].u - this.veh[i].length - this.veh[iLagNew].u
        var speedLagNew = this.veh[iLagNew].speed
        var accLagNew = this.veh[iLagNew].longModel.calcAcc(sLagNew, speedLagNew, speed)

         // final MOBIL incentive/safety test before actual lane change
         // (regular lane changes; for merges, see below)

        var MOBILOK = this.veh[i].LCModel.realizeLaneChange(vrel, acc, accNew, accLagNew, toRight, false)

        changeSuccessful = (this.veh[i].type != 'obstacle') && (sNew > 0) && (sLagNew > 0) && MOBILOK
        if (changeSuccessful) {
             // do lane change in the direction toRight (left if toRight=0)
       //! ! only regular lane changes within road; merging/diverging separately!

          this.veh[i].dt_lastLC = 0                // active LC
          this.veh[iLagNew].dt_lastPassiveLC = 0   // passive LC
          this.veh[iLeadNew].dt_lastPassiveLC = 0
          this.veh[iLead].dt_lastPassiveLC = 0
          this.veh[iLag].dt_lastLPassiveC = 0

          this.veh[i].laneOld = this.veh[i].lane
          this.veh[i].lane = newLane
          this.veh[i].acc = accNew
          this.veh[iLagNew].acc = accLagNew

           // optionally change acceleration of the old follower

          if (log) { console.log('after lane change! veh ' + i
             + ' from lane ' + this.veh[i].laneOld
             + ' to ' + this.veh[i].lane + ' ')
          }

           // update the local envionment implies 12 updates,
           // better simply to update all ...

          this.updateEnvironment()
        }
      }
    }
  }
  // return changeSuccessful;
}

// END NEW 25.06.2016

// ######################################################################
// functionality for merging and diverging to another road.
// ######################################################################
/**
In both cases, the road change is from the actual road
to the road in the argument list. Only the immediately neighboring
lanes of the two roads interact. The rest must be handled in the
strategic/tactical lane-change behaviour of the drivers

@param newRoad: the road to which to merge or diverge
@param offset:  difference[m] in the arclength coordinate u
                between new and old road
@param ustart:  start[m] of the merging/diverging zone in old-road coordinates
@param uend:    end[m] of the merging/diverging zone in old-road coordinates
                Notice: If merge, exclude virtual vehicle pos from u-range!
@param isMerge: if true, merge; otherwise diverge.
@param toRight: direction of the merge/diverge.

@return:        void. Both roads are affected!
*/

road.prototype.mergeDiverge = function (newRoad, offset, uStart, uEnd, isMerge, toRight) {
  var log = false
  if (log) { console.log('\n\nitime=' + itime + ': in road.mergeDiverge') }

    // (1) get neighbourhood

  var uNewStart = uStart + offset
  var uNewEnd = uEnd + offset
  var padding = 50 // additional visibility  on target road before/after
  var originLane = (toRight) ? this.nLanes - 1 : 0
  var targetLane = (toRight) ? 0 : newRoad.nLanes - 1

     // getTargetNeighbourhood also sets this.iOffset, newRoad.iOffset
  var originVehicles = this.getTargetNeighbourhood(uStart, uEnd, originLane)

  var targetVehicles = newRoad.getTargetNeighbourhood(
  uNewStart - padding, uNewEnd + padding, targetLane)

  var iMerge = 0 // candidate
  var uTarget // arc-length coordinate of the successfully changing veh(if any)

    // (2) select changing vehicle (if any):
    // only one at each calling; the first vehicle has priority!

    // immediate success if no target vehicles in neighbourhood
    // and at least one (real) origin vehicle: the first one changes

  var success = ((targetVehicles.length == 0) && (originVehicles.length > 0)
      && (originVehicles[0].type != 'obstacle')
      && (originVehicles[0].mandatoryLCahead))
  if (success) { iMerge = 0; uTarget = originVehicles[0].u + offset }

    // else select the first suitable candidate on the origin lane (if any)

  else if (originVehicles.length > 0) {  // or >1 necessary? !!
    var duLeader = 1000 // initially big distances w/o interaction
    var duFollower = -1000
    var leaderNew = new vehicle(0, 0, uNewStart + 10000, targetLane, 0, 'car')
    var followerNew = new vehicle(0, 0, uNewStart - 10000, targetLane, 0, 'car')
    if (log) { console.log('entering origVeh loop') }
    for (var i = 0; (i < originVehicles.length) && (!success); i++) { // merging veh loop
      if ((originVehicles[i].type != 'obstacle') && (originVehicles[i].mandatoryLCahead)) {
        uTarget = originVehicles[i].u + offset
        if (log) { console.log(' i=' + i) }
        for (var j = 0; j < targetVehicles.length; j++) {
          var du = targetVehicles[j].u - uTarget
          if ((du > 0) && (du < duLeader)) {
            duLeader = du; leaderNew = targetVehicles[j]
          }
          if ((du < 0) && (du > duFollower)) {
            duFollower = du; followerNew = targetVehicles[j]
          }
          if (log) {
            console.log('  du=' + du + ' duLeader=' + duLeader
        + ' duFollower=' + duFollower)
          }
        }

              // get input variables for MOBIL

        var sNew = duLeader - leaderNew.length
        var sLagNew = -duFollower - originVehicles[i].length
        var speedLeadNew = leaderNew.speed
        var speedLagNew = followerNew.speed
        var speed = originVehicles[i].speed

        var bSafeMergeMin = this.MOBIL_bSafeMandat
        var bSafeMergeMax = this.MOBIL_bSafeMax
        var bBiasMerge = (toRight) ? 0.5 * bSafeMergeMax
      : -0.5 * bSafeMergeMax // strong urge to change
        var longModel = originVehicles[i].longModel

              //! !! this alt: LCModel with locally defined bSafe params 6 and 17
        var LCModel = new MOBIL(bSafeMergeMin, bSafeMergeMax, 0, bBiasMerge)

              //! !! this alt: LCModel* overwritten from top-level routines! bSafe=42
        // var LCModel=(toRight) ? this.LCModelMandatoryRight
     // : this.LCModelMandatoryLeft;

        var vrel = originVehicles[i].speed / originVehicles[i].longModel.v0
        var acc = originVehicles[i].acc
        var accNew = longModel.calcAcc(sNew, speed, speedLeadNew)
        var accLagNew = longModel.calcAcc(sLagNew, speedLagNew, speed)

              // lane changing to merge on new road (regular LC above)
        var MOBILOK = LCModel.realizeLaneChange(vrel, acc, accNew, accLagNew, toRight, false)

        success = MOBILOK && (originVehicles[i].type != 'obstacle')
      && (sNew > 0) && (sLagNew > 0)
      && (originVehicles[i].mandatoryLCahead)

        if (log && (this.roadID == 2)) {
          console.log('in road.mergeDiverge: roadID=' + this.roadID
            + ' LCModel.bSafeMax=' + LCModel.bSafeMax)
        }
        if (success) { iMerge = i }

        if (success && log) {
          console.log('testing origin veh ' + i + ' type='
          + originVehicles[i].type + ' uTarget=' + uTarget)
          console.log('  sNew=' + sNew + ' sLagNew=' + sLagNew)
          console.log('  speed=' + speed + ' speedLagNew=' + speedLagNew)
          console.log('  acc=' + acc + ' accNew=' + accNew + ' accLagNew=' + accLagNew)
          console.log('  duLeader=' + duLeader + '  duFollower=' + duFollower
          + ' sLagNew=' + sLagNew
          + ' MOBILOK=' + MOBILOK + ' success=' + success)
        }
      } // !obstacle
    }// merging veh loop
  }// else branch (there are target vehicles)

    // (3) if success, do the actual merging!

  if (success) {
 // do the actual merging

        // originVehicles[iMerge]=veh[iMerge+this.iOffset]

    var iOrig = iMerge + this.iOffset
    if (log) {
  // if(true){
      console.log('Actual merging: merging origin vehicle ' + iOrig
      + ' of type ' + this.veh[iOrig].type
      + ' from origin position ' + this.veh[iOrig].u
      + ' and origin lane' + originLane
      + ' to target position ' + uTarget
      + ' and target lane' + targetLane)
      console.log(' this.veh[iOrig].mandatoryLCahead)='
      + this.veh[iOrig].mandatoryLCahead)
    }

    var changingVeh = this.veh[iOrig] // originVehicles[iMerge];
    var vOld = (toRight) ? targetLane - 1 : targetLane + 1 // rel. to NEW road
    changingVeh.u += offset
    changingVeh.lane = targetLane
    changingVeh.laneOld = vOld // following for  drawing purposes
    changingVeh.v = vOld  // real lane position (graphical)

    changingVeh.dt_lastLC = 0             // just changed
    changingVeh.mandatoryLCahead = false // reset mandatory LC behaviour

//! !! get index of this.veh and splice this; otherwise probably no effect
// ####################################################################
    this.veh.splice(iOrig, 1)// removes chg veh from orig.
    newRoad.veh.push(changingVeh) // appends changingVeh at last pos;
// ####################################################################

    this.nveh = this.veh.length // !! updates array lengths
    newRoad.nveh = newRoad.veh.length
    newRoad.sortVehicles()       // move the mergingVeh at correct position
    newRoad.updateEnvironment() // and provide updated neighbors
  }// end do the actual merging
}// end mergeDiverge

// ######################################################################
// get heading (relative to road)
// ######################################################################

road.prototype.updateOrientation = function () {
  for (var i = 0; i < this.nveh; i++) {
    this.veh[i].dvdu = get_dvdu(this.veh[i].dt_lastLC, dt_LC, // get_dvdu from paths.js
             this.veh[i].laneOld,
             this.veh[i].lane, this.veh[i].speed)
  }
}

// ######################################################################
// update truck percentage by changing vehicle type of existing vehs
  // do not correct if minor mismatch
  // since this can happen due to inflow/outflow
  // open roads: mismatchTolerated about 0.2; ring: mismatchTolerated=0
// ######################################################################

road.prototype.updateTruckFrac = function (truckFrac, mismatchTolerated) {
  if (this.veh.length > 0) {
    this.updateEnvironment() // needs veh[i].iLag etc, so actual environment needed
    var n = this.veh.length
    var nTruckDesired = Math.floor(n * truckFrac)
    var nTruck = 0
    for (var i = 0; i < n; i++) {
      if (this.veh[i].type == 'truck') { nTruck++ }
    }
    var truckFracReal = nTruck / n  // integer division results generally in double: OK!

    // action if truck frac not as wanted;
    // correct by one veh transformation per timestep

    if (Math.abs(truckFracReal - truckFrac) > mismatchTolerated) {
      var truckFracTooLow = (nTruckDesired > nTruck)
      var newType = (truckFracTooLow) ? 'truck' : 'car'
      var newLength = (truckFracTooLow) ? truck_length : car_length
      var newWidth = (truckFracTooLow) ? truck_width : car_width
      var newLongModel = (truckFracTooLow) ? longModelTruck : longModelCar
      var diffSpace = ((truckFracTooLow) ? -1 : 1) * (truck_length - car_length)
      var success = 0 // false at beginning

        // find the candidate vehicle (truck or car) with the largest lag gap

      var candidateType = (truckFracTooLow) ? 'car' : 'truck'
      var k = 0  // considered veh index

      if (truckFracTooLow) { // change cars->trucks on the right lane if possible
        var maxSpace = 0
        for (var lane = this.nLanes - 1; lane >= 0; lane--) { if (!success) {
          for (var i = 0; i < n; i++) {
            if ((this.veh[i].lane == lane) && (this.veh[i].type == candidateType)) {
              var iLag = this.veh[i].iLag
              var s = this.veh[i].u - this.veh[iLag].u - this.veh[i].length
              if (iLag < i) { s += this.roadLen }// periodic BC (OK for open BC as well)
              if (s > maxSpace) { k = i; maxSpace = s }
              success = (maxSpace > diffSpace)
            }
          }
        } }
      }

      else { // change trucks->cars: transform truck with smallest space
        var minSpace = 10000
        for (var i = 0; i < n; i++) {
          if (this.veh[i].type == candidateType) {
            success = 1 // always true for trucks->cars if there is a truck
            var iLag = this.veh[i].iLag
            var s = this.veh[i].u - this.veh[iLag].u - this.veh[i].length
            if ((iLag < i) && (s < 0)) { s += this.roadLen }// periodic BC (OK for open BC as well)
            if (s < minSpace) { k = i; minSpace = s }
          }
        }
      }

        // actually do the transformation if no collision entails by it

   // console.log("in updateTruckFrac: nTruck="+nTruck+" nTruckDesired="+nTruckDesired+" k="+k+" maxSpace="+maxSpace+" candidateType=" +candidateType+" newType="+newType);

      if (success) {
        this.veh[k].type = newType
        this.veh[k].length = newLength
        this.veh[k].width = newWidth
        this.veh[k].longModel = newLongModel
      }
    }
  }
}

// ######################################################################
// update vehicle density by adding vehicles into largest gaps
// or removing some randomly picked vehicles (one at a time)
// ######################################################################

road.prototype.updateDensity = function (density) {
  var nDesired = Math.floor(this.nLanes * this.roadLen * density)
  var nveh_old = this.nveh
  if (this.nveh > nDesired) { // too many vehicles, remove one per time step
    var r = Math.random()
    var k = Math.floor(this.nveh * r)
    this.veh.splice(k, 1) // remove vehicle at random position k  (k=0 ... n-1)
    this.nveh--
  }
  else if (this.nveh < nDesired) { // too few vehicles, generate one per time step in largest gap
    var maxSpace = 0
    var k = 0 // considered veh index
    var success = false
    var emptyLanes = false

        // initialize attributes of new vehicle
        // (later overwritten in most cases)

    var laneNew = 0
    var uNew = 0.5 * this.roadLen
    var vehType = (Math.random() < truckFrac) ? 'truck' : 'car'
    var vehLength = (vehType == 'car') ? car_length : truck_length
    var vehWidth = (vehType == 'car') ? car_width : truck_width
    var speedNew = 0 // always overwritten

        // test if there are lanes w/o vehicles which will not be caught
        // by main search for largest gap

    var nvehLane = []
    for (var il = 0; il < this.nLanes; il++) { nvehLane[il] = 0 }
    for (var i = 0; i < this.nveh; i++) { nvehLane[this.veh[i].lane]++ }
  // console.log("nveh="+this.nveh);
  // for (var il=0; il<this.nLanes; il++){
  //    console.log("road.updateDensity: lane="+il+" #veh="+nvehLane[il]);
  // }
    for (var il = 0; (il < this.nLanes) && (!success); il++) {
      if (nvehLane[il] == 0) {
        success = true
        emptyLanes = true
        laneNew = il
      }
    }

        // if there are no empty lanes, search the largest gap

    if (!emptyLanes) {
      for (var i = 0; i < this.nveh; i++) {
        var iLead = this.veh[i].iLead
        var s = this.veh[iLead].u - this.veh[iLead].length - this.veh[i].u
        if ((iLead >= i) && (s < 0)) { s += this.roadLen }// periodic BC
        if (s > maxSpace) { k = i; maxSpace = s }
      };
      success = (maxSpace > car_length + 2 * this.veh[k].longModel.s0)
    }

        // actually add vehicles

    if (success) { // otherwise, no veh added
      if (!emptyLanes) {
        uNew = this.veh[k].u + 0.5 * (car_length + maxSpace)
        if (uNew > this.roadLen) { uNew -= this.roadLen }  // periodic BC
        laneNew = this.veh[k].lane
        speedNew = 0.5 * (this.veh[k].speed + this.veh[this.veh[k].iLead].speed)
      }

      var vehNew = new vehicle(vehLength, vehWidth, uNew, laneNew,
            speedNew, vehType)
      vehNew.longModel = (vehType == 'car') ? longModelCar : longModelTruck
      if (emptyLanes) { vehNew.speed = vehNew.longModel.v0 }
      this.veh.splice(k, 0, vehNew) // add vehicle at position k  (k=0 ... n-1)
      this.nveh++
    }
  }
    // sort (re-sort) vehicles with respect to decreasing positions
    // and provide the updated local environment to each vehicle

  if (this.nveh != nveh_old) {
    this.sortVehicles()
    this.updateEnvironment()
  }
} // updateDensity

// ######################################################################
// downstream BC: drop at most one vehicle at a time (no action needed if isRing)
// ######################################################################

road.prototype.updateBCdown = function () {
  var nvehOld = this.nveh
  if ((!this.isRing) && (this.veh.length > 0)) {
    if (this.veh[0].u > this.roadLen) {
    // console.log("road.updateBCdown: nveh="+this.nveh+" removing one vehicle);
      this.veh.splice(0, 1)
      this.nveh--
    }
    if (this.nveh < nvehOld) { this.updateEnvironment() }
  }
}

// ######################################################################
// upstream BC: insert vehicles at total flow Qin (only applicable if !isRing)
// route is optional parameter (default: route=[])
// ######################################################################

road.prototype.updateBCup = function (Qin, dt, route) {
  this.route = (typeof route === 'undefined') ? [0] : route // handle opt. args

  var log = false
  // if(log){console.log("in road.updateBCup: inVehBuffer="+this.inVehBuffer);}

  var smin = 15 // only inflow if largest gap is at least smin
  var success = 0 // false initially
  if (!this.isRing) {
    this.inVehBuffer += Qin * dt
  }

  if (this.inVehBuffer >= 1) {
    // get new vehicle characteristics
    var vehType = (Math.random() < truckFrac) ? 'truck' : 'car'
    var vehLength = (vehType == 'car') ? car_length : truck_length
    var vehWidth = (vehType == 'car') ? car_width : truck_width
    var space = 0 // available bumper-to-bumper space gap

      // try to set trucks at the right lane

    var lane = this.nLanes - 1 // start with right lane
    if (this.nveh == 0) { success = true; space = this.roadLen }

    else if (vehType == 'truck') {
      var iLead = this.nveh - 1
      while ((iLead > 0) && (this.veh[iLead].lane != lane)) { iLead-- }
      space = this.veh[iLead].u - this.veh[iLead].length
      success = (iLead < 0) || (space > smin)
    }

      // if road not empty or a truck could not be placed on the right lane
      // try, as well as for cars, if there is any lane with enough space

    if (!success) {
      var spaceMax = 0
      for (var candLane = this.nLanes - 1; candLane >= 0; candLane--) {
        var iLead = this.nveh - 1
        while ((iLead >= 0) && (this.veh[iLead].lane != candLane)) { iLead-- }
        space = (iLead >= 0) // "minus candLine" implements right-driving
        ? this.veh[iLead].u - this.veh[iLead].length : this.roadLen + candLane
        if (space > spaceMax) {
          lane = candLane
          spaceMax = space
        }
      }
      success = (space >= smin)
    }

      // actually insert new vehicle

    if (success) {
      var longModelNew = (vehType == 'car') ? longModelCar : longModelTruck
      var uNew = 0
      var speedNew = Math.min(longModelNew.v0, longModelNew.speedlimit,
        space / longModelNew.T)
      var vehNew = new vehicle(vehLength, vehWidth, uNew, lane, speedNew, vehType)
      vehNew.longModel = longModelNew
      vehNew.route = this.route

      this.veh.push(vehNew) // add vehicle after pos nveh-1
      this.inVehBuffer -= 1
      this.nveh++
      if (false) {
        console.log('road.updateBCup: new vehicle at pos u=0, lane ' + lane
        + ', type ' + vehType + ', s=' + space + ', speed=' + speedNew)
        console.log(this.veh.length) //! !!!
        for (var i = 0; i < this.veh.length; i++) {
          console.log('i=' + i + ' this.veh[i].u=' + this.veh[i].u
+ ' this.veh[i].route=' + this.veh[i].route)
        }
      }
    // if(this.route.length>0){console.log("new veh entered: route="+this.veh[this.veh.length-1].route);}//!!
    }
  }
}

// ######################################################################
// get target vehicle neighbourhood/context for merging of other roads
// returns targetVehicles, an array of all vehicles on the target lane
// inside the arclength range [umin, umax].
// Also sets iOffset, the first vehicle (smallest i) within range
// ######################################################################

road.prototype.getTargetNeighbourhood = function (umin, umax, targetLane) {
  var targetVehicles = []
  var iTarget = 0
  var firstTime = true
  for (var i = 0; i < this.veh.length; i++) {
    if ((this.veh[i].lane == targetLane) && (this.veh[i].u >= umin) && (this.veh[i].u <= umax)) {
      if (firstTime == true) { this.iOffset = i; firstTime = false }
      targetVehicles[iTarget] = this.veh[i]
      iTarget++
    }
  }
  if (false) {
    console.log('in road.getTargetNeighbourhood(umin=' + umin + ', umax=' + umax
      + ', targetLane=' + targetLane + ')')
    for (iTarget = 0; iTarget < targetVehicles.length; iTarget++) {
      console.log('targetVehicles[' + iTarget + '].u=' + targetVehicles[iTarget].u)
    }
  }
  return targetVehicles
}

// ####################################################
// distribute model parameters updated from  GUI to all vehicles
// ####################################################

road.prototype.updateModelsOfAllVehicles = function (longModelCar, longModelTruck,
              LCModelCar, LCModelTruck) {
  this.nveh = this.veh.length // just in case; this is typically first cmd for update

  for (var i = 0; i < this.nveh; i++) {
    if (this.veh[i].type != 'obstacle') { // then do nothing
      this.veh[i].longModel = (this.veh[i].type == 'car')
    ? longModelCar : longModelTruck
      this.veh[i].LCModel = (this.veh[i].type == 'car')
    ? LCModelCar : LCModelTruck
    }
  }

  // update tactical info for mandatory lane changes upstream of offramps

  if (this.duTactical > 0) for (var i = 0; i < this.nveh; i++) {
    var iNextOff = this.getNextOffIndex(this.veh[i].u) // -1 if nothing
    var uLastExit = this.offrampLastExits[iNextOff]

    if ((this.veh[i].type != 'obstacle')
   && (iNextOff > -1)
   && (uLastExit - this.veh[i].u < this.duTactical)) {
      if (false) { console.log('in road.updateModels... iveh=' + i
          + ' iNextOff=' + iNextOff
          + ' u=' + this.veh[i].u
          + ' uLastExit=' + uLastExit)
      }
      var offID = this.offrampIDs[iNextOff]
      var route = this.veh[i].route
      var mandatoryLC = false
      for (var ir = 0; ir < route.length; ir++) {
        if (offID == route[ir]) { mandatoryLC = true }
      }
      if (mandatoryLC) {
        this.veh[i].mandatoryLCahead = true
        var toRight = this.offrampToRight[iNextOff]
        this.veh[i].longModel.alpha_v0 = 1// reduce speed before diverging

        this.veh[i].LCModel = (toRight) ? this.LCModelMandatoryRight
            : this.LCModelMandatoryLeft
        if (false) { console.log('apply mandatoryLC to Vehicle ' + i + '!'
        + 'route=' + this.veh[i].route
        + ' offID=' + offID
        + ' uLastExit=' + uLastExit
        + ' u=' + this.veh[i].u
        + ' alpha_v0=' + this.veh[i].longModel.alpha_v0
        + ' bBiasRight=' + this.veh[i].LCModel.bBiasRight
           )
        }
      }
    }
    else { // no mandatory LC because obstacle, no offramps, mainroad route
            // (no need to reset LC models since this is done above)
      this.veh[i].longModel.alpha_v0 = 1
      //! !! works as links for all car longmodels or
      // truck longmodels of a road!!
      // DOS if reset here, all slow if not
       // => logging of road.calcAccelerations
      // README set accel models individually (new?)
    }
  }
}

// ######################################################################
// update times since last change for all vehicles (min time between changes)
// ######################################################################

road.prototype.updateLastLCtimes = function (dt) {
  for (var i = 0; i < this.nveh; i++) {
    this.veh[i].dt_lastLC += dt
    this.veh[i].dt_lastPassiveLC += dt
  }
}
// ######################################################################
// get direction of road at arclength u
// ######################################################################
/**
@param traj_x(u), traj_y(u)=phys. road geometry as parametrized
       function of the arc length
@param u=actual arclength for which to get direction
@return direction (heading) of the road (0=East, pi/2=North etc)
*/

road.prototype.get_phi = function (traj_x, traj_y, u) {
  var smallVal = 0.0000001

  var du = 0.1
  var dx = traj_x(u + du) - traj_x(u - du)
  var dy = traj_y(u + du) - traj_y(u - du)
  var phi = (Math.abs(dx) < smallVal) ? 0.5 * Math.PI : Math.atan(dy / dx)
  if ((dx < 0) || ((Math.abs(dx) < smallVal) && (dy < 0))) { phi += Math.PI }
  return phi
}

// ######################################################################
// draw road (w/o vehicles; for letter -> drawVehicles(...)
// ######################################################################

/**
@param traj_x(u), traj_y(u)=phys. road geometry as parametrized function of the arc length
@param scale translates physical road coordinbates into pixel:[scale]=pixels/m
@return draw into graphics context ctx (defined in calling routine)
*/

road.prototype.draw = function (roadImg, scale, traj_x, traj_y, laneWidth) {
  var smallVal = 0.0000001
  var boundaryStripWidth = 0.3 * laneWidth

  var factor = 1 + this.nLanes * laneWidth * this.draw_curvMax // "stitch factor"
  var lSegm = this.roadLen / this.draw_nSegm

    // only at beginning or after rescaling

  if (Math.abs(scale - this.draw_scaleOld) > smallVal) {
    this.draw_scaleOld = scale
    for (var iSegm = 0; iSegm < this.draw_nSegm; iSegm++) {
      var u = this.roadLen * (iSegm + 0.5) / this.draw_nSegm
      this.draw_x[iSegm] = traj_x(u)
      this.draw_y[iSegm] = traj_y(u)
      this.draw_phi[iSegm] = this.get_phi(traj_x, traj_y, u)
      this.draw_cosphi[iSegm] = Math.cos(this.draw_phi[iSegm])
      this.draw_sinphi[iSegm] = Math.sin(this.draw_phi[iSegm])

      if (false) {
        console.log('road.draw: iSegm=' + iSegm + ' u=' + u
         + ' xPhys=' + this.draw_x[iSegm]
                   + ' yPhys=' + this.draw_y[iSegm]
                   + ' phi=' + this.draw_phi[iSegm])
      }
    }
  }

    // actual drawing routine

  for (var iSegm = 0; iSegm < this.draw_nSegm; iSegm++) {
    var cosphi = this.draw_cosphi[iSegm]
    var sinphi = this.draw_sinphi[iSegm]
    var lSegmPix = scale * factor * lSegm
  // var lSegmPix=scale*1*lSegm;
    var wSegmPix = scale * (this.nLanes * laneWidth + boundaryStripWidth)

    // road center of two-lane road has v=1 (vPhys=laneWidth)
         //  notice phi_v=phi-pi/2
        // yPix downwards;
    var vCenterPhys = 0.0 * this.nLanes * laneWidth // check if not =0 if traj at center!!
    var xCenterPix = scale * (this.draw_x[iSegm] + vCenterPhys * sinphi)
    var yCenterPix = -scale * (this.draw_y[iSegm] - vCenterPhys * cosphi)
    ctx.setTransform(cosphi, -sinphi, +sinphi, cosphi, xCenterPix, yCenterPix)
    ctx.drawImage(roadImg, -0.5 * lSegmPix, -0.5 * wSegmPix, lSegmPix, wSegmPix)
    if (false) {
      console.log('road.draw: iSegm=' + iSegm +
          ' cosphi=' + cosphi + ' factor=' + factor +
          ' lSegmPix=' + lSegmPix + ' wSegmPix=' + wSegmPix +
          ' xCenterPix=' + xCenterPix + ' yCenterPix=' + yCenterPix)
    }
  }
}// draw road

// ######################################################################
// draw vehicles
// ######################################################################

/**
@param scale: translates physical coordinbates into pixel:[scale]=pixels/m
@param traj_x(u), traj_y(u): phys. road geometry
       as parameterized function of the arc length
@param laneWidth: lane width in m
@param speedmin,speedmax: speed range [m/s] for the colormap
       (red=slow,blue=fast)
@param umin,umax: optional restriction of the long drawing range
       (useful when drawing veh only when fully entered
       or re-drawing merging veh)
@return draw into graphics context ctx (defined in calling routine)
*/

road.prototype.drawVehicles = function (carImg, truckImg, obstacleImg, scale,
             traj_x, traj_y, laneWidth,
             speedmin, speedmax,
             umin, umax) {
  var noRestriction = (typeof umin === 'undefined')

  for (var i = 0; i < this.veh.length; i++) {
    if (noRestriction || ((this.veh[i].u >= umin) && (this.veh[i].u <= umax))) {
      var type = this.veh[i].type
      var vehLenPix = scale * this.veh[i].length
      var vehWidthPix = scale * this.veh[i].width
      var uCenterPhys = this.veh[i].u - 0.5 * this.veh[i].length

          // v increasing from left to right, 0 @ road center

      var vCenterPhys = laneWidth * (this.veh[i].v - 0.5 * (this.nLanes - 1))

      var phiRoad = this.get_phi(traj_x, traj_y, uCenterPhys)
      var phiVehRel = (Math.abs(this.veh[i].dvdu) < 0.00001)
    ? 0 : -Math.atan(this.veh[i].dvdu)
      var phiVeh = phiRoad + phiVehRel
      var cphiRoad = Math.cos(phiRoad)
      var sphiRoad = Math.sin(phiRoad)
      var cphiVeh = Math.cos(phiVeh)
      var sphiVeh = Math.sin(phiVeh)
      var xCenterPix = scale * (traj_x(uCenterPhys) + vCenterPhys * sphiRoad)
      var yCenterPix = -scale * (traj_y(uCenterPhys) - vCenterPhys * cphiRoad)

          // (1) draw vehicles as images

      vehImg = (type == 'car') ? carImg : (type == 'truck') ? truckImg : obstacleImg
      ctx.setTransform(cphiVeh, -sphiVeh, +sphiVeh, cphiVeh, xCenterPix, yCenterPix)
      ctx.drawImage(vehImg, -0.5 * vehLenPix, -0.5 * vehWidthPix,
      vehLenPix, vehWidthPix)

          // (2) draw semi-transp boxes of speed-dependent color
          //     over the images
          //     (different size of box because of mirrors of veh images)

      if (type != 'obstacle') {
        var effLenPix = (type == 'car') ? 0.95 * vehLenPix : 0.90 * vehLenPix
        var effWPix = (type == 'car') ? 0.55 * vehWidthPix : 0.70 * vehWidthPix
        var speed = this.veh[i].speed
        ctx.fillStyle = colormapSpeed(speed, speedmin, speedmax, type)
        ctx.fillRect(-0.5 * effLenPix, -0.5 * effWPix, effLenPix, effWPix)
      }
      ctx.fillStyle = 'rgb(0,0,0)'

      if (false) {
    // if(this.veh[i].v>2){
        console.log('in road.drawVehicles:'
        + ' u=' + this.veh[i].u
        + ' v=' + this.veh[i].v
        + ' xCenterPix=' + xCenterPix
        + ' yCenterPix=' + yCenterPix
       )
      }
    }
  }
}
