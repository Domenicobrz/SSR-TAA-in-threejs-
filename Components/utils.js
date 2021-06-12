let Utils = { };

Utils.onResize = function(element, callback) {
    const resize_ob = new ResizeObserver((entries) => {
        // since we are observing only a single element, so we access the first element in entries array
        let rect = entries[0].contentRect;
    
        // current width & height
        let width = rect.width;
        let height = rect.height;
    
        callback(width, height);
    });

    // start observing for resize
    resize_ob.observe(element);
}

export default Utils;