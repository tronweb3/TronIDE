FROM nginx:alpine
WORKDIR /

COPY ./temp_publish_docker/ /usr/share/nginx/html/
# Serve with the hardened nginx.conf so the image sends the CSP / X-Frame-Options
# / X-Content-Type-Options response headers (the stock nginx.conf does not).
COPY ./nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
