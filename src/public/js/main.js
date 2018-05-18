console.log('loading 6...')

$(function () {

    var dismissAlertButton = "<button type=\"button\" class=\"close\" data-hide=\"alert\" aria-label=\"Close\">\n" +
        "        <span aria-hidden=\"true\">&times;</span>\n" +
        "    </button>"

    var alertSuccess = "<div class='alert alert-success'>";
    var alertFail = "<div class='alert alert-danger'>";

    var debug = false

    var displayAlert = function (data) {
        if (data.result === 'ok') {
            html = alertSuccess + data.text + dismissAlertButton + "</div"
        }
        else {
            // result is error
            html = alertFail + data.text + dismissAlertButton + "</div"
        }
        $('.alert').html(html);
        $('.alert').show()
    }


    // initialize datetimepicker
    $('#datepicker').datetimepicker(
        {
            useCurrent: true,
            ignoreReadonly: true,
            defaultDate: new Date()

        })


    $('#submit_filter').click(function () {
        if (debug) {
            console.log('clicked filter change button')
            console.log('for time: ', $('#datepicker').data("DateTimePicker").date().format("dddd, MMMM Do YYYY, h:mm:ss a"))
        }


        $.ajax({
            url: "api/filter_change",
            data: {datetime: $('#datepicker').data("DateTimePicker").date().unix()}
        }).done(function (data) {
            if (debug) {
                console.log('submitted filter change')
                console.log('result: %s', JSON.stringify(data))
            }
            displayAlert(data);
        });
    })

    $('#submit_tank').click(function () {

        // get an associative array of just the values.
        arr = $('#tank_refill_form').find('input, select, button').serializeArray()
        arr.push({
            'name': 'chemical',
            'value': $('#tank_refill_form').find('[clicked=true]').attr('id')
        })
        arr.push({
            'name': 'datetime',
            'value': $('#datepicker').data("DateTimePicker").date().unix()
        })

        if (debug) {
            console.log(arr)
            console.log('for time: ', $('#datepicker').data("DateTimePicker").date().format("dddd, MMMM Do YYYY, h:mm:ss a"))
            arr.forEach(function (el) {
                console.log(el.name + ' ' + el.value)
            })
        }

        $.ajax({
            url: "api/tank_refill",
            data: arr
        }).done(function (data) {
            if (debug) {
                console.log('submitted tank refill')
                console.log('result: %s', JSON.stringify(data))
            }
            displayAlert(data);
        });
    });


    $('#submit_chemistry').click(function () {


        // get an associative array of just the values.
        arr = $('#chemistry_form').find('input').serializeArray()

        arr.push({
            'name': 'datetime',
            'value': $('#datepicker').data("DateTimePicker").date().unix()
        })

        if (debug) {
            console.log('for time: ', $('#datepicker').data("DateTimePicker").date().format("dddd, MMMM Do YYYY, h:mm:ss a"))
            console.log(arr)


            arr.forEach(function (el) {
                console.log(el.name + ' ' + el.value)
            })
        }


        $.ajax({
            url: "api/chemistry",
            data: arr
        }).done(function (data) {
            if (debug) {
                console.log('submitted chemistry')
                console.log('result: %s', JSON.stringify(data))
            }
            displayAlert(data);
        });
    });


    $('#acid, #fc_bleach').click(function () {
        if (debug) {
            console.log('clicked: ' + jQuery(this).attr("id"))
        }
        if (jQuery(this).attr("id") === 'acid') {
            $('#acid').addClass('btn-primary')
            $('#acid').removeClass('btn-secondary')
            $('#fc_bleach').removeClass('btn-primary')
            $('#fc_bleach').addClass('btn-secondary')
            $('#acid').attr('clicked', true)
            $('#fc_bleach').attr('clicked', false)
        }
        else {
            $('#acid').addClass('btn-secondary')
            $('#acid').removeClass('btn-primary')
            $('#fc_bleach').removeClass('btn-secondary')
            $('#fc_bleach').addClass('btn-primary')
            $('#acid').attr('clicked', false)
            $('#fc_bleach').attr('clicked', true)

        }

    })

    // to allow re-useable alerts; otherwise the data-dismiss completely destroys the alert
    // per https://stackoverflow.com/questions/13550477/twitter-bootstrap-alert-message-close-and-open-again

    // and finally, dynamically bind to the parent since we are destroying the data-hide button every time we create an alert
    $('#alert_parent').on('click', '[data-hide]', function () {
        $("." + $(this).attr("data-hide")).hide();
    })

})

