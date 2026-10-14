function requestPermission() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(permissionState => {
          if (permissionState === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation);
          }
        });
    } else {
      window.addEventListener('deviceorientation', handleOrientation);
    }
  }
  
  function handleOrientation(event) {
    let heading = event.webkitCompassHeading || (360 - event.alpha);
  
    if (heading === null) return;
  
    document.getElementById("direction").innerText =
      "方位: " + Math.round(heading) + "°";
  
    let arrow = document.getElementById("arrow");
  
    // 北を指す矢印
    arrow.style.transform = "rotate(" + (-heading) + "deg)";
  }